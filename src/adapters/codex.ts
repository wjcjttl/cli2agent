import { execSync } from 'child_process';
import type { CliAdapter, AdapterSpawnOptions } from './types.js';
import type { CliEvent, CliAssistantEvent, CliResultEvent, CliErrorEvent } from '../types/cli-events.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';

/**
 * Adapter for OpenAI's Codex CLI.
 *
 * Binary: `codex`
 * Package: @openai/codex
 * Headless: `codex "prompt" --json --full-auto`
 * Output: JSONL events to stdout
 *
 * Auth: OPENAI_API_KEY env var, or ChatGPT OAuth
 *
 * Codex is a Rust binary with a different event schema than Claude.
 * The --json flag outputs JSONL events.
 */
export class CodexAdapter implements CliAdapter {
  readonly name = 'codex';
  private cachedBin: string | undefined;

  resolveBinary(): string {
    if (this.cachedBin) return this.cachedBin;

    if (process.env.CODEX_BIN) {
      this.cachedBin = process.env.CODEX_BIN;
      logger.debug({ bin: this.cachedBin }, 'codex.resolve: env override');
      return this.cachedBin;
    }

    try {
      this.cachedBin = execSync('which codex', { encoding: 'utf-8' }).trim();
      logger.debug({ bin: this.cachedBin }, 'codex.resolve: found via which');
      return this.cachedBin;
    } catch {
      this.cachedBin = 'codex';
      logger.debug({ bin: this.cachedBin }, 'codex.resolve: fallback');
      return this.cachedBin;
    }
  }

  async buildArgs(options: AdapterSpawnOptions): Promise<string[]> {
    const args: string[] = [
      options.prompt,
      '--json',
      '--full-auto',
    ];

    if (options.model || config.defaultModel) {
      args.push('--model', options.model || config.defaultModel!);
    }

    if (options.workspace) {
      args.push('--cd', options.workspace);
    }

    return args;
  }

  buildEnv(): Record<string, string | undefined> {
    return {
      CI: '1',
    };
  }

  normalizeEvent(raw: Record<string, unknown>): CliEvent | null {
    const type = raw.type as string | undefined;
    if (!type) return null;

    // Codex JSONL event types (from codex --json output):
    //   Various events — normalize to our standard format

    // Text/message events
    if (type === 'message' || type === 'response') {
      const content = raw.content || raw.text || raw.message;
      if (typeof content === 'string') {
        return {
          type: 'assistant',
          message: {
            id: (raw.id as string) || '',
            model: (raw.model as string) || '',
            role: 'assistant',
            content: [{ type: 'text', text: content }],
            stop_reason: null,
            usage: normalizeUsage(raw.usage),
          },
          ...baseFields(raw),
        } as CliAssistantEvent;
      }
      // Array content blocks
      if (Array.isArray(content)) {
        return {
          type: 'assistant',
          message: {
            id: (raw.id as string) || '',
            model: (raw.model as string) || '',
            role: 'assistant',
            content: normalizeCodexContent(content),
            stop_reason: (raw.stop_reason as string) || null,
            usage: normalizeUsage(raw.usage),
          },
          ...baseFields(raw),
        } as CliAssistantEvent;
      }
    }

    // Tool execution events
    if (type === 'function_call' || type === 'tool_call') {
      return {
        type: 'assistant',
        message: {
          id: '',
          model: '',
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: (raw.call_id as string) || (raw.id as string) || '',
            name: (raw.name as string) || (raw.function as string) || '',
            input: (raw.arguments as Record<string, unknown>) || (raw.input as Record<string, unknown>) || {},
          }],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        ...baseFields(raw),
      } as CliAssistantEvent;
    }

    if (type === 'function_call_output' || type === 'tool_result') {
      return {
        type: 'tool_result',
        message: null,
        toolUseResult: raw.output ?? raw.result ?? '',
        sourceToolAssistantUUID: (raw.call_id as string) || '',
        ...baseFields(raw),
      } as unknown as CliEvent;
    }

    // Error events
    if (type === 'error') {
      return {
        type: 'error',
        error: {
          type: 'cli_error',
          message: (raw.message as string) || (raw.error as string) || 'Unknown Codex error',
        },
        ...baseFields(raw),
      } as CliErrorEvent;
    }

    // Completion/result events
    if (type === 'completed' || type === 'done') {
      return {
        type: 'result',
        result: (raw.result as string) || '',
        duration_ms: (raw.duration_ms as number) || 0,
        num_turns: (raw.num_turns as number) || 0,
        usage: normalizeUsage(raw.usage),
        ...baseFields(raw),
      } as CliResultEvent;
    }

    // Pass through unknown events with generic type
    return null;
  }

  async sessionExists(_sessionId: string): Promise<boolean> {
    // Codex session management is handled differently
    // --resume support via subcommand: `codex resume <id>`
    return false;
  }
}

function normalizeCodexContent(content: unknown[]): CliAssistantEvent['message']['content'] {
  return content.map((block: unknown) => {
    if (typeof block === 'string') return { type: 'text' as const, text: block };
    const b = block as Record<string, unknown>;
    if (b.type === 'text') return { type: 'text' as const, text: (b.text as string) || '' };
    if (b.type === 'output_text') return { type: 'text' as const, text: (b.text as string) || '' };
    return { type: 'text' as const, text: JSON.stringify(block) };
  });
}

function normalizeUsage(usage: unknown): { input_tokens: number; output_tokens: number } {
  if (!usage || typeof usage !== 'object') return { input_tokens: 0, output_tokens: 0 };
  const u = usage as Record<string, unknown>;
  return {
    input_tokens: (u.input_tokens as number) || 0,
    output_tokens: (u.output_tokens as number) || 0,
  };
}

function baseFields(raw: Record<string, unknown>): Partial<CliEvent> {
  return {
    uuid: (raw.uuid as string) || (raw.id as string) || '',
    timestamp: (raw.timestamp as string) || new Date().toISOString(),
    sessionId: (raw.sessionId as string) || '',
  } as Partial<CliEvent>;
}
