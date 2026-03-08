import { execSync } from 'child_process';
import type { CliAdapter, AdapterSpawnOptions } from './types.js';
import type { CliEvent } from '../types/cli-events.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';

/**
 * Adapter for Moonshot's Kimi Code CLI.
 *
 * Binary: `kimi`
 * Package: kimi-cli (pip)
 * Headless: `kimi --print -p "prompt" --output-format stream-json --yolo`
 * Output: NDJSON with events very similar to Claude Code's format
 *
 * Auth: `kimi login` (Moonshot OAuth), or configured in ~/.kimi/config.toml
 *
 * Kimi Code CLI is Python-based (installed via pip).
 */
export class KimiAdapter implements CliAdapter {
  readonly name = 'kimi';
  private cachedBin: string | undefined;

  resolveBinary(): string {
    if (this.cachedBin) return this.cachedBin;

    if (process.env.KIMI_BIN) {
      this.cachedBin = process.env.KIMI_BIN;
      logger.debug({ bin: this.cachedBin }, 'kimi.resolve: env override');
      return this.cachedBin;
    }

    try {
      this.cachedBin = execSync('which kimi', { encoding: 'utf-8' }).trim();
      logger.debug({ bin: this.cachedBin }, 'kimi.resolve: found via which');
      return this.cachedBin;
    } catch {
      this.cachedBin = 'kimi';
      logger.debug({ bin: this.cachedBin }, 'kimi.resolve: fallback');
      return this.cachedBin;
    }
  }

  async buildArgs(options: AdapterSpawnOptions): Promise<string[]> {
    const args: string[] = [
      '--print',
      '-p', options.prompt,
      '--output-format', 'stream-json',
      '--yolo',
    ];

    // Session continuation
    if (await this.sessionExists(options.sessionId)) {
      args.push('--session', options.sessionId);
    }

    if (options.model || config.defaultModel) {
      args.push('--model', options.model || config.defaultModel!);
    }

    if (options.workspace) {
      args.push('--work-dir', options.workspace);
    }

    if (options.maxTurns) {
      args.push('--max-steps-per-turn', String(options.maxTurns));
    }

    if (options.systemPrompt) {
      // Kimi doesn't have a direct --system-prompt flag; would need agent file
      // For now, prepend to prompt
    }

    return args;
  }

  buildEnv(): Record<string, string | undefined> {
    return {
      CI: '1',
    };
  }

  normalizeEvent(raw: Record<string, unknown>): CliEvent | null {
    // Kimi's stream-json output is very similar to Claude's format
    // The event types and structure are nearly identical
    if (!raw.type || typeof raw.type !== 'string') return null;
    return raw as unknown as CliEvent;
  }

  async sessionExists(_sessionId: string): Promise<boolean> {
    // Kimi manages sessions internally; --session flag handles create-or-resume
    return false;
  }
}
