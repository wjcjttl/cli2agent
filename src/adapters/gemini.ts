import { execSync } from 'child_process';
import type { CliAdapter, AdapterSpawnOptions } from './types.js';
import type { CliEvent, CliAssistantEvent, CliResultEvent, CliErrorEvent } from '../types/cli-events.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';

/**
 * Adapter for Google's Gemini CLI.
 *
 * Binary: `gemini`
 * Package: @google/gemini-cli
 * Headless: `gemini "prompt" --output-format stream-json --approval-mode=yolo`
 * Output: NDJSON with event types: init, message, tool_use, tool_result, error, result
 *
 * Auth: GEMINI_API_KEY env var, or Google OAuth, or Vertex AI
 */
export class GeminiAdapter implements CliAdapter {
  readonly name = 'gemini';
  private cachedBin: string | undefined;

  resolveBinary(): string {
    if (this.cachedBin) return this.cachedBin;

    if (process.env.GEMINI_BIN) {
      this.cachedBin = process.env.GEMINI_BIN;
      logger.debug({ bin: this.cachedBin }, 'gemini.resolve: env override');
      return this.cachedBin;
    }

    try {
      this.cachedBin = execSync('which gemini', { encoding: 'utf-8' }).trim();
      logger.debug({ bin: this.cachedBin }, 'gemini.resolve: found via which');
      return this.cachedBin;
    } catch {
      this.cachedBin = 'gemini';
      logger.debug({ bin: this.cachedBin }, 'gemini.resolve: fallback');
      return this.cachedBin;
    }
  }

  async buildArgs(options: AdapterSpawnOptions): Promise<string[]> {
    const args: string[] = [
      options.prompt,
      '--output-format', 'stream-json',
      '--approval-mode=yolo',
    ];

    // Session resumption
    if (await this.sessionExists(options.sessionId)) {
      args.push('--resume', options.sessionId);
    }

    if (options.model || config.defaultModel) {
      args.push('--model', options.model || config.defaultModel!);
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

    // Gemini stream-json events map closely to Claude's format:
    //   init → skip (session metadata)
    //   message → assistant or user
    //   tool_use → assistant with tool_use content block
    //   tool_result → tool_result
    //   error → error
    //   result → result

    if (type === 'init') {
      // Session metadata — skip
      return null;
    }

    if (type === 'message') {
      // Gemini message events contain role and content similar to Claude
      const role = (raw as Record<string, unknown>).role as string | undefined;
      if (role === 'assistant' || !role) {
        return {
          type: 'assistant',
          message: {
            id: (raw.id as string) || '',
            model: (raw.model as string) || '',
            role: 'assistant',
            content: normalizeGeminiContent(raw.content),
            stop_reason: (raw.stop_reason as string) || null,
            usage: normalizeUsage(raw.usage),
          },
          ...baseFields(raw),
        } as CliAssistantEvent;
      }
      return null;
    }

    if (type === 'tool_use') {
      return {
        type: 'assistant',
        message: {
          id: '',
          model: '',
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: (raw.id as string) || '',
            name: (raw.name as string) || (raw.tool as string) || '',
            input: (raw.input as Record<string, unknown>) || {},
          }],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        ...baseFields(raw),
      } as CliAssistantEvent;
    }

    if (type === 'tool_result') {
      return {
        type: 'tool_result',
        message: null,
        toolUseResult: raw.output ?? raw.result ?? '',
        sourceToolAssistantUUID: '',
        ...baseFields(raw),
      } as unknown as CliEvent;
    }

    if (type === 'error') {
      return {
        type: 'error',
        error: {
          type: (raw.error_type as string) || 'cli_error',
          message: (raw.message as string) || (raw.error as string) || 'Unknown error',
        },
        ...baseFields(raw),
      } as CliErrorEvent;
    }

    if (type === 'result') {
      return {
        type: 'result',
        result: (raw.response as string) || '',
        duration_ms: (raw.duration_ms as number) || 0,
        num_turns: (raw.num_turns as number) || 0,
        usage: normalizeUsage(raw.usage ?? raw.stats),
        ...baseFields(raw),
      } as CliResultEvent;
    }

    return null;
  }

  async sessionExists(_sessionId: string): Promise<boolean> {
    // Gemini stores sessions differently; for now always treat as new
    // Session resume via --resume with session ID is handled by Gemini itself
    return false;
  }
}

function normalizeGeminiContent(content: unknown): CliAssistantEvent['message']['content'] {
  if (!content) return [];
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) {
    return content.map((block: Record<string, unknown>) => {
      if (block.type === 'text') return { type: 'text' as const, text: (block.text as string) || '' };
      if (block.type === 'thinking') return { type: 'thinking' as const, thinking: (block.thinking as string) || (block.text as string) || '' };
      if (block.type === 'tool_use') return { type: 'tool_use' as const, id: (block.id as string) || '', name: (block.name as string) || '', input: (block.input as Record<string, unknown>) || {} };
      return { type: 'text' as const, text: JSON.stringify(block) };
    });
  }
  return [{ type: 'text', text: JSON.stringify(content) }];
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
    uuid: (raw.uuid as string) || '',
    timestamp: (raw.timestamp as string) || new Date().toISOString(),
    sessionId: (raw.sessionId as string) || (raw.session_id as string) || '',
  } as Partial<CliEvent>;
}
