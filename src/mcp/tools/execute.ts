import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { v4 as uuidv4 } from 'uuid';
import type { SessionManager } from '../../services/session-manager.js';
import { spawnCliProcess } from '../../services/cli-process.js';
import { iterateNdjsonStream } from '../../stream/ndjson-parser.js';
import { config } from '../../config.js';
import type { CliAssistantEvent, CliErrorEvent, CliResultEvent, CliToolResultEvent } from '../../types/cli-events.js';

type ContentBlock = {
  type: string;
  text?: string;
  tool?: string;
  input?: unknown;
  output?: string;
};

export function registerExecuteTool(server: McpServer, sessions: SessionManager): void {
  server.tool(
    'execute',
    'Execute a prompt against Claude Code CLI. Blocks until completion and returns the full result including assistant response text, tool usage, and token counts.',
    {
      session_id: z.string().optional().describe('Existing session ID. If omitted, a new session is created.'),
      prompt: z.string().describe('The prompt to send to Claude Code'),
      max_turns: z.number().int().optional().describe('Maximum agentic turns (default: 25)'),
      allowed_tools: z.array(z.string()).optional().describe('Allowed tool names for the CLI'),
      system_prompt: z.string().optional().describe('System prompt override'),
      model: z.string().optional().describe('Claude model to use'),
    },
    async (args, extra) => {
      // Get or create session
      const session = sessions.getOrCreate(args.session_id);

      // Acquire session lock
      if (!sessions.tryLock(session.id)) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'session_busy', message: 'Session is currently processing another request' }) }],
          isError: true,
        };
      }

      const taskId = uuidv4();
      const startTime = Date.now();
      const contentBlocks: ContentBlock[] = [];
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let turns = 0;

      // Set up abort handler for transport disconnect
      const handle = await spawnCliProcess({
        prompt: args.prompt,
        sessionId: session.id,
        workspace: session.workspace,
        model: args.model || session.model || undefined,
        maxTurns: args.max_turns || config.defaultMaxTurns,
        allowedTools: args.allowed_tools,
        systemPrompt: args.system_prompt,
      });

      sessions.registerProcess(session.id, handle);

      const abortHandler = () => { handle.kill(); };

      // Check if already aborted before we start
      if (extra.signal.aborted) {
        handle.kill();
        sessions.markErrored(session.id);
        sessions.releaseLock(session.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: 'transport_closed' }) }],
          isError: true,
        };
      }

      extra.signal.addEventListener('abort', abortHandler, { once: true });

      try {
        if (!handle.process.stdout) throw new Error('CLI process stdout not available');

        // Collect stderr for error reporting
        let stderrData = '';
        handle.process.stderr?.on('data', (chunk: Buffer) => {
          stderrData += chunk.toString();
        });

        // Iterate NDJSON stream and collect content blocks
        for await (const event of iterateNdjsonStream(handle.process.stdout, handle.adapter)) {
          if (event.type === 'assistant') {
            const msg = (event as CliAssistantEvent).message;
            if (msg?.content) {
              for (const block of msg.content) {
                if (block.type === 'text' && 'text' in block) {
                  contentBlocks.push({ type: 'text', text: block.text });
                  // Fire-and-forget logging notification for text delta
                  server.sendLoggingMessage({
                    level: 'info',
                    data: { type: 'text_delta', text: block.text },
                  }).catch(() => {});
                } else if (block.type === 'thinking' && 'thinking' in block) {
                  contentBlocks.push({ type: 'thinking', text: block.thinking });
                  // Thinking collected but not logged per CONTEXT.md decision
                } else if (block.type === 'tool_use' && 'name' in block) {
                  contentBlocks.push({ type: 'tool_use', tool: block.name, input: block.input });
                  // Fire-and-forget logging notification for tool use
                  server.sendLoggingMessage({
                    level: 'info',
                    data: { type: 'tool_use', tool: block.name, input: block.input },
                  }).catch(() => {});
                }
              }
            }
            if (msg?.usage) {
              totalInputTokens += msg.usage.input_tokens || 0;
              totalOutputTokens += msg.usage.output_tokens || 0;
            }
          } else if (event.type === 'tool_result') {
            const tr = event as CliToolResultEvent;
            if (tr.toolUseResult) {
              contentBlocks.push({
                type: 'tool_result',
                tool: 'unknown',
                output: typeof tr.toolUseResult === 'string'
                  ? tr.toolUseResult
                  : JSON.stringify(tr.toolUseResult),
              });
            }
          } else if (event.type === 'result') {
            const resultEvent = event as CliResultEvent;
            turns = resultEvent.num_turns || 0;
          } else if (event.type === 'error') {
            const errEvent = event as CliErrorEvent;
            // Fire-and-forget logging notification for errors
            server.sendLoggingMessage({
              level: 'warning',
              data: { type: 'error', message: errEvent.error?.message || 'Unknown CLI error' },
            }).catch(() => {});
          }
        }

        // Wait for process to exit
        const exitCode = await waitForExit(handle.process);

        // Mark session completed
        sessions.markCompleted(session.id, {
          input_tokens: totalInputTokens,
          output_tokens: totalOutputTokens,
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              task_id: taskId,
              session_id: session.id,
              status: exitCode === 0 ? 'completed' : 'failed',
              content: contentBlocks,
              usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
              duration_ms: Date.now() - startTime,
              turns,
            }),
          }],
        };
      } catch (err) {
        sessions.markErrored(session.id);
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
          isError: true,
        };
      } finally {
        extra.signal.removeEventListener('abort', abortHandler);
        sessions.releaseLock(session.id);
      }
    },
  );
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
