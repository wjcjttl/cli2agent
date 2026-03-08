import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { v4 as uuidv4 } from 'uuid';
import { spawnCliProcess } from '../services/cli-process.js';
import type { SessionManager } from '../services/session-manager.js';
import { pool } from '../services/shared-pool.js';
import { iterateNdjsonStream } from '../stream/ndjson-parser.js';
import { SseWriter } from '../stream/sse-writer.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';
import {
  ExecuteRequestSchema,
  ExecuteResponseSchema,
  CancelParamsSchema,
  ErrorResponseSchema,
  type ExecuteContentBlock,
} from '../schemas/index.js';
import type { CliAssistantEvent, CliEvent, CliResultEvent, CliToolResultEvent } from '../types/cli-events.js';

export function registerExecuteRoutes(app: FastifyInstance, sessions: SessionManager): void {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.route({
    method: 'POST',
    url: '/v1/execute',
    schema: {
      description: `Execute a prompt against Claude Code CLI.

By default streams Server-Sent Events (SSE). Set stream=false for a single JSON response.

### SSE Event Types

When streaming is enabled, the following events are emitted:

- **task_start**: { task_id, session_id, status: 'running' } — Sent when execution begins
- **thinking_delta**: { text } — Thinking content chunks (when include_thinking is true)
- **text_delta**: { text } — Assistant response text chunks
- **tool_use**: { tool, input } — Tool invocation by the assistant
- **tool_result**: { tool, output } — Tool execution result
- **task_complete**: { task_id, status, duration_ms, turns } — Sent when execution finishes successfully
- **task_error**: { task_id, error } — Sent when execution encounters an error`,
      tags: ['Execute'],
      body: ExecuteRequestSchema,
      response: {
        200: ExecuteResponseSchema,
        400: ErrorResponseSchema,
        409: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const body = request.body;

      // Get or create session
      const session = sessions.getOrCreate(body.session_id);

      // Try to acquire session lock
      if (!sessions.tryLock(session.id)) {
        return reply.status(409).send({
          error: 'session_busy',
          message: 'Session is currently processing another request',
        });
      }

      const taskId = uuidv4();
      const stream = body.stream !== false; // Default to streaming

      logger.info({ taskId, sessionId: session.id, promptLength: body.prompt.length, stream }, 'execute.start');

      // Acquire a process slot from the global pool
      try {
        await pool.acquire();
      } catch (err) {
        sessions.releaseLock(session.id);
        return reply.status(429).send({
          error: 'queue_timeout',
          message: 'All process slots are busy. Try again later.',
        });
      }

      try {
        const handle = await spawnCliProcess({
          prompt: body.prompt,
          sessionId: session.id,
          workspace: session.workspace,
          model: body.model || session.model || undefined,
          maxTurns: body.max_turns || config.defaultMaxTurns,
          allowedTools: body.allowed_tools,
          systemPrompt: body.system_prompt,
        });

        sessions.registerProcess(session.id, handle);

        if (stream) {
          await handleStreaming(request, reply, handle, taskId, session.id, sessions);
        } else {
          await handleNonStreaming(reply, handle, taskId, session.id, sessions);
        }
      } catch (err) {
        sessions.releaseLock(session.id);
        const message = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ taskId, sessionId: session.id, err }, 'execute.error');
        return reply.status(500).send({ error: 'execution_failed', message });
      } finally {
        pool.release();
      }
    },
  });

  typedApp.route({
    method: 'POST',
    url: '/v1/execute/:task_id/cancel',
    schema: {
      description: 'Cancel a running execution task (not yet implemented)',
      tags: ['Execute'],
      params: CancelParamsSchema,
      response: {
        501: ErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      // For now, cancellation requires knowing the session ID
      // In a future iteration, we'd track task_id → session_id mapping
      return reply.status(501).send({ error: 'not_implemented', message: 'Task cancellation coming in Phase 3' });
    },
  });
}

async function handleStreaming(
  request: { raw: { on: (event: string, cb: () => void) => void } },
  reply: import('fastify').FastifyReply,
  handle: import('../services/cli-process.js').CliProcessHandle,
  taskId: string,
  sessionId: string,
  sessions: SessionManager,
): Promise<void> {
  const proc = handle.process;
  const sse = new SseWriter(reply);
  sse.init();

  // Handle client disconnect
  request.raw.on('close', () => {
    logger.warn({ taskId, sessionId }, 'execute.client.disconnect');
    sse.markClosed();
    if (!proc.killed) proc.kill('SIGTERM');
  });

  // Send task_start
  await sse.write('task_start', { task_id: taskId, session_id: sessionId, status: 'running' });

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let turns = 0;
  const startTime = Date.now();

  try {
    if (!proc.stdout) throw new Error('CLI process stdout not available');

    // Collect stderr for error reporting
    let stderrData = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrData += chunk.toString();
    });

    for await (const event of iterateNdjsonStream(proc.stdout, handle.adapter)) {
      if (sse.isClosed) break;
      await processEventForSse(event, sse);

      // Track usage from assistant events
      if (event.type === 'assistant') {
        const assistantEvent = event as CliAssistantEvent;
        if (assistantEvent.message?.usage) {
          totalInputTokens += assistantEvent.message.usage.input_tokens || 0;
          totalOutputTokens += assistantEvent.message.usage.output_tokens || 0;
        }
      }

      if (event.type === 'result') {
        const resultEvent = event as CliResultEvent;
        turns = resultEvent.num_turns || 0;
      }
    }

    // Wait for process to exit
    const exitCode = await waitForExit(proc);

    if (!sse.isClosed) {
      if (exitCode === 0) {
        const durationMs = Date.now() - startTime;
        logger.info({ taskId, durationMs, turns, inputTokens: totalInputTokens, outputTokens: totalOutputTokens }, 'execute.complete');
        await sse.write('task_complete', {
          task_id: taskId,
          status: 'completed',
          duration_ms: durationMs,
          turns,
        });
      } else {
        await sse.write('task_error', {
          task_id: taskId,
          error: stderrData.trim() || `CLI exited with code ${exitCode}`,
        });
      }
    }

    sessions.markCompleted(sessionId, {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    });
  } catch (err) {
    logger.error({ taskId, sessionId, err }, 'execute.error');
    sessions.markErrored(sessionId);
    if (!sse.isClosed) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await sse.write('task_error', { task_id: taskId, error: message });
    }
  } finally {
    sse.end();
  }
}

async function handleNonStreaming(
  reply: import('fastify').FastifyReply,
  handle: import('../services/cli-process.js').CliProcessHandle,
  taskId: string,
  sessionId: string,
  sessions: SessionManager,
): Promise<void> {
  const proc = handle.process;
  const content: ExecuteContentBlock[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let turns = 0;
  const startTime = Date.now();

  let stderrData = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderrData += chunk.toString();
  });

  try {
    if (!proc.stdout) throw new Error('CLI process stdout not available');

    for await (const event of iterateNdjsonStream(proc.stdout, handle.adapter)) {
      collectContentBlock(event, content);

      if (event.type === 'assistant') {
        const assistantEvent = event as CliAssistantEvent;
        if (assistantEvent.message?.usage) {
          totalInputTokens += assistantEvent.message.usage.input_tokens || 0;
          totalOutputTokens += assistantEvent.message.usage.output_tokens || 0;
        }
      }

      if (event.type === 'result') {
        const resultEvent = event as CliResultEvent;
        turns = resultEvent.num_turns || 0;
      }
    }

    const exitCode = await waitForExit(proc);

    // Check for CLI initialization errors (e.g., invalid API key)
    // CLI may output errors to stderr and exit cleanly without producing any events
    if (content.length === 0 && stderrData) {
      sessions.markErrored(sessionId);
      return reply.status(500).send({
        error: 'execution_failed',
        message: `CLI failed: ${stderrData.trim()}`,
      });
    }

    sessions.markCompleted(sessionId, {
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    });

    const durationMs = Date.now() - startTime;
    logger.info({ taskId, durationMs, turns, inputTokens: totalInputTokens, outputTokens: totalOutputTokens }, 'execute.complete');

    return reply.status(200).send({
      task_id: taskId,
      session_id: sessionId,
      status: exitCode === 0 ? 'completed' : 'failed',
      content,
      usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
      duration_ms: durationMs,
      turns,
    });
  } catch (err) {
    logger.error({ taskId, sessionId, err }, 'execute.error');
    sessions.markErrored(sessionId);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return reply.status(500).send({
      error: 'execution_failed',
      message: `${message}${stderrData ? ': ' + stderrData.trim() : ''}`,
    });
  }
}

/** Convert a CLI event to SSE events for streaming */
async function processEventForSse(event: CliEvent, sse: SseWriter): Promise<void> {
  if (sse.isClosed) return;

  switch (event.type) {
    case 'assistant': {
      const msg = (event as CliAssistantEvent).message;
      if (!msg?.content) break;
      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          await sse.write('text_delta', { text: block.text });
        } else if (block.type === 'thinking' && block.thinking) {
          await sse.write('thinking_delta', { text: block.thinking });
        } else if (block.type === 'tool_use') {
          await sse.write('tool_use', { tool: block.name, input: block.input });
        }
      }
      break;
    }
    case 'tool_result': {
      const tr = event as CliToolResultEvent;
      if (tr.toolUseResult) {
        await sse.write('tool_result', {
          tool: 'unknown',
          output: typeof tr.toolUseResult === 'string'
            ? tr.toolUseResult
            : JSON.stringify(tr.toolUseResult),
        });
      }
      break;
    }
    case 'error': {
      const errEvent = event as { error?: { message?: string } };
      await sse.write('task_error', {
        task_id: 'unknown',
        error: errEvent.error?.message || 'Unknown CLI error',
      });
      break;
    }
    // Skip progress, user, file-history-snapshot, etc.
  }
}

/** Collect content blocks for non-streaming responses */
function collectContentBlock(event: CliEvent, content: ExecuteContentBlock[]): void {
  if (event.type === 'assistant') {
    const msg = (event as CliAssistantEvent).message;
    if (!msg?.content) return;
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) {
        content.push({ type: 'text', text: block.text });
      } else if (block.type === 'thinking' && block.thinking) {
        content.push({ type: 'thinking', text: block.thinking });
      } else if (block.type === 'tool_use') {
        content.push({ type: 'tool_use', tool: block.name, input: block.input });
      }
    }
  } else if (event.type === 'tool_result') {
    const tr = event as CliToolResultEvent;
    if (tr.toolUseResult) {
      content.push({
        type: 'tool_result',
        tool: 'unknown',
        output: typeof tr.toolUseResult === 'string'
          ? tr.toolUseResult
          : JSON.stringify(tr.toolUseResult),
      });
    }
  }
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
