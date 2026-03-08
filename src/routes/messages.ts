import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { v4 as uuidv4 } from 'uuid';
import { spawnCliProcess } from '../services/cli-process.js';
import type { SessionManager } from '../services/session-manager.js';
import { pool } from '../services/shared-pool.js';
import { iterateNdjsonStream } from '../stream/ndjson-parser.js';
import { AnthropicSseTranslator } from '../stream/anthropic-translator.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';
import {
  MessagesRequestSchema,
  MessagesResponseSchema,
  MessagesErrorResponseSchema,
} from '../schemas/messages.js';
import type { CliAssistantEvent } from '../types/cli-events.js';

function generateMessageId(): string {
  return `msg_${uuidv4().replace(/-/g, '')}`;
}

/**
 * Extract a single prompt string from Anthropic Messages API messages array.
 * Concatenates all user messages. For assistant messages, they provide context
 * but are not sent as prompt (the CLI handles session history via --resume).
 */
export function extractPrompt(messages: Array<{ role: string; content: string | unknown[] }>): string {
  const parts: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        parts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === 'object' && block !== null && 'type' in block) {
            const b = block as { type: string; text?: string };
            if (b.type === 'text' && b.text) {
              parts.push(b.text);
            }
          }
        }
      }
    }
  }

  return parts.join('\n\n');
}

export function registerMessageRoutes(app: FastifyInstance, sessions: SessionManager): void {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.route({
    method: 'POST',
    url: '/v1/messages',
    schema: {
      description: `Anthropic Messages API compatible endpoint.

Accepts the standard Anthropic Messages API format and translates to/from the CLI's NDJSON format.
This makes cli2agent a drop-in backend for Cline, Cursor, LangChain, and the Anthropic SDK.

Supports both streaming (SSE) and non-streaming modes.`,
      tags: ['Messages'],
      body: MessagesRequestSchema,
      response: {
        200: MessagesResponseSchema,
        409: MessagesErrorResponseSchema,
        429: MessagesErrorResponseSchema,
        500: MessagesErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const body = request.body;
      const messageId = generateMessageId();
      const model = body.model;
      const stream = body.stream === true;

      // Extract session ID from metadata or create new
      const sessionId = body.metadata?.session_id;
      const session = sessions.getOrCreate(sessionId);

      logger.info({ messageId, sessionId: session.id, model, stream, messageCount: body.messages.length }, 'messages.start');

      // Try to acquire session lock
      if (!sessions.tryLock(session.id)) {
        return reply.status(409).send({
          type: 'error' as const,
          error: {
            type: 'conflict',
            message: 'Session is currently processing another request',
          },
        });
      }

      // Acquire a process slot
      try {
        await pool.acquire();
      } catch {
        sessions.releaseLock(session.id);
        return reply.status(429).send({
          type: 'error' as const,
          error: {
            type: 'rate_limit_error',
            message: 'All process slots are busy. Try again later.',
          },
        });
      }

      try {
        const prompt = extractPrompt(body.messages);

        const handle = await spawnCliProcess({
          prompt,
          sessionId: session.id,
          workspace: session.workspace,
          model: model || session.model || undefined,
          maxTurns: config.defaultMaxTurns,
          systemPrompt: body.system,
        });

        sessions.registerProcess(session.id, handle);

        if (stream) {
          await handleStreaming(request, reply, handle, messageId, model, session.id, sessions);
        } else {
          await handleNonStreaming(reply, handle, messageId, model, session.id, sessions);
        }
      } catch (err) {
        sessions.releaseLock(session.id);
        const message = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ messageId, sessionId: session.id, error: message }, 'messages.error');
        return reply.status(500).send({
          type: 'error' as const,
          error: {
            type: 'api_error',
            message,
          },
        });
      } finally {
        pool.release();
      }
    },
  });
}

async function handleStreaming(
  request: { raw: { on: (event: string, cb: () => void) => void } },
  reply: import('fastify').FastifyReply,
  handle: import('../services/cli-process.js').CliProcessHandle,
  messageId: string,
  model: string,
  sessionId: string,
  sessions: SessionManager,
): Promise<void> {
  const proc = handle.process;
  const translator = new AnthropicSseTranslator(reply, messageId, model);
  await translator.init();

  // Handle client disconnect
  request.raw.on('close', () => {
    translator.markClosed();
    if (!proc.killed) proc.kill('SIGTERM');
  });

  try {
    if (!proc.stdout) throw new Error('CLI process stdout not available');

    let stderrData = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
    });

    for await (const event of iterateNdjsonStream(proc.stdout, handle.adapter)) {
      if (translator.isClosed) break;
      await translator.processEvent(event);
    }

    // Wait for process exit
    const exitCode = await waitForExit(proc);

    if (!translator.isClosed) {
      if (exitCode === 0) {
        await translator.finish('end_turn');
      } else {
        await translator.finish('end_turn');
      }
    }

    sessions.markCompleted(sessionId, translator.usage);
    logger.info({ messageId, sessionId, ...translator.usage }, 'messages.complete');
  } catch (err) {
    sessions.markErrored(sessionId);
    logger.error({ messageId, sessionId, error: err instanceof Error ? err.message : 'Unknown' }, 'messages.error');
  } finally {
    translator.end();
  }
}

async function handleNonStreaming(
  reply: import('fastify').FastifyReply,
  handle: import('../services/cli-process.js').CliProcessHandle,
  messageId: string,
  model: string,
  sessionId: string,
  sessions: SessionManager,
): Promise<void> {
  const proc = handle.process;
  const content: Array<{ type: 'text'; text: string } | { type: 'thinking'; thinking: string }> = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  let stderrData = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrData += chunk.toString();
  });

  try {
    if (!proc.stdout) throw new Error('CLI process stdout not available');

    for await (const event of iterateNdjsonStream(proc.stdout, handle.adapter)) {
      if (event.type === 'assistant') {
        const assistantEvent = event as CliAssistantEvent;
        const msg = assistantEvent.message;

        if (msg?.usage) {
          totalInputTokens += msg.usage.input_tokens || 0;
          totalOutputTokens += msg.usage.output_tokens || 0;
        }

        if (msg?.content) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              content.push({ type: 'text', text: block.text });
            } else if (block.type === 'thinking' && block.thinking) {
              content.push({ type: 'thinking', thinking: block.thinking });
            }
          }
        }
      }
    }

    await waitForExit(proc);

    // Check for CLI initialization errors
    if (content.length === 0 && stderrData) {
      sessions.markErrored(sessionId);
      return reply.status(500).send({
        type: 'error' as const,
        error: {
          type: 'api_error',
          message: `CLI failed: ${stderrData.trim()}`,
        },
      });
    }

    sessions.markCompleted(sessionId, {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    });

    // Merge consecutive text blocks into one
    const mergedContent = mergeTextBlocks(content);

    return reply.status(200).send({
      id: messageId,
      type: 'message' as const,
      role: 'assistant' as const,
      content: mergedContent,
      model,
      stop_reason: 'end_turn' as const,
      stop_sequence: null,
      usage: {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
      },
    });
  } catch (err) {
    sessions.markErrored(sessionId);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return reply.status(500).send({
      type: 'error' as const,
      error: {
        type: 'api_error',
        message: `${message}${stderrData ? ': ' + stderrData.trim() : ''}`,
      },
    });
  }
}

/** Merge consecutive text blocks into a single block */
export function mergeTextBlocks(
  content: Array<{ type: 'text'; text: string } | { type: 'thinking'; thinking: string }>,
): Array<{ type: 'text'; text: string } | { type: 'thinking'; thinking: string }> {
  if (content.length === 0) return content;

  const merged: typeof content = [];
  for (const block of content) {
    const last = merged[merged.length - 1];
    if (block.type === 'text' && last?.type === 'text') {
      last.text += block.text;
    } else {
      merged.push({ ...block });
    }
  }
  return merged;
}

function waitForExit(proc: import('child_process').ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) {
      resolve(proc.exitCode);
      return;
    }
    proc.once('exit', (code) => resolve(code ?? 1));
  });
}
