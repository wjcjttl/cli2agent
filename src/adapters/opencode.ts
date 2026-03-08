import { execSync } from 'child_process';
import type { CliAdapter, AdapterSpawnOptions } from './types.js';
import type { CliEvent, CliAssistantEvent, CliErrorEvent } from '../types/cli-events.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';

/**
 * Adapter for OpenCode CLI.
 *
 * Binary: `opencode`
 * Package: opencode-ai (npm)
 * Headless: `opencode run "message" --format json`
 * Output: JSONL events (tool_use, step_start, step_finish, text, reasoning, error)
 *
 * Auth: Provider-dependent (configured in opencode config)
 *
 * Note: OpenCode uses a client/server architecture internally.
 * In `run` mode, it starts a local server and connects via SDK.
 */
export class OpenCodeAdapter implements CliAdapter {
  readonly name = 'opencode';
  private cachedBin: string | undefined;

  resolveBinary(): string {
    if (this.cachedBin) return this.cachedBin;

    if (process.env.OPENCODE_BIN) {
      this.cachedBin = process.env.OPENCODE_BIN;
      logger.debug({ bin: this.cachedBin }, 'opencode.resolve: env override');
      return this.cachedBin;
    }

    try {
      this.cachedBin = execSync('which opencode', { encoding: 'utf-8' }).trim();
      logger.debug({ bin: this.cachedBin }, 'opencode.resolve: found via which');
      return this.cachedBin;
    } catch {
      this.cachedBin = 'opencode';
      logger.debug({ bin: this.cachedBin }, 'opencode.resolve: fallback');
      return this.cachedBin;
    }
  }

  async buildArgs(options: AdapterSpawnOptions): Promise<string[]> {
    const args: string[] = [
      'run',
      options.prompt,
      '--format', 'json',
    ];

    // Session continuation
    if (await this.sessionExists(options.sessionId)) {
      args.push('--session', options.sessionId);
    }

    if (options.model || config.defaultModel) {
      args.push('--model', options.model || config.defaultModel!);
    }

    if (options.workspace) {
      args.push('--dir', options.workspace);
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

    // OpenCode run --format json event types:
    //   tool_use, step_start, step_finish, text, reasoning, error

    if (type === 'text') {
      const part = raw.part as Record<string, unknown> | undefined;
      const text = part?.text as string || raw.text as string || '';
      if (!text) return null;
      return {
        type: 'assistant',
        message: {
          id: '',
          model: '',
          role: 'assistant',
          content: [{ type: 'text', text }],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        ...baseFields(raw),
      } as CliAssistantEvent;
    }

    if (type === 'reasoning') {
      const part = raw.part as Record<string, unknown> | undefined;
      const thinking = part?.text as string || raw.text as string || '';
      if (!thinking) return null;
      return {
        type: 'assistant',
        message: {
          id: '',
          model: '',
          role: 'assistant',
          content: [{ type: 'thinking', thinking }],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        ...baseFields(raw),
      } as CliAssistantEvent;
    }

    if (type === 'tool_use') {
      const part = raw.part as Record<string, unknown> | undefined;
      const tool = part?.tool as string || raw.tool as string || '';
      const state = part?.state as Record<string, unknown> | undefined;
      const input = state?.input as Record<string, unknown> || {};
      return {
        type: 'assistant',
        message: {
          id: '',
          model: '',
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: (part?.id as string) || '',
            name: tool,
            input,
          }],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        ...baseFields(raw),
      } as CliAssistantEvent;
    }

    if (type === 'error') {
      const error = raw.error as Record<string, unknown> | undefined;
      return {
        type: 'error',
        error: {
          type: 'cli_error',
          message: (error?.message as string) || (raw.error as string) || 'Unknown OpenCode error',
        },
        ...baseFields(raw),
      } as CliErrorEvent;
    }

    // step_start, step_finish — skip (internal progress events)
    return null;
  }

  async sessionExists(_sessionId: string): Promise<boolean> {
    // OpenCode manages sessions internally
    return false;
  }
}

function baseFields(raw: Record<string, unknown>): Partial<CliEvent> {
  return {
    uuid: (raw.id as string) || '',
    timestamp: new Date().toISOString(),
    sessionId: (raw.sessionID as string) || '',
  } as Partial<CliEvent>;
}
