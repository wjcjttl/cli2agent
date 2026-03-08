import { execSync } from 'child_process';
import { access, readdir } from 'fs/promises';
import { join } from 'path';
import type { CliAdapter, AdapterSpawnOptions } from './types.js';
import type { CliEvent } from '../types/cli-events.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';

/**
 * Adapter for Anthropic's Claude Code CLI.
 *
 * Binary: `claude`
 * Headless: `claude -p "prompt" --output-format stream-json`
 * Output: NDJSON with event types: assistant, user, tool_result, progress, result, error
 */
export class ClaudeAdapter implements CliAdapter {
  readonly name = 'claude';
  private cachedBin: string | undefined;

  resolveBinary(): string {
    if (this.cachedBin) return this.cachedBin;

    if (process.env.CLAUDE_BIN) {
      this.cachedBin = process.env.CLAUDE_BIN;
      logger.debug({ bin: this.cachedBin }, 'claude.resolve: env override');
      return this.cachedBin;
    }

    try {
      this.cachedBin = execSync('which claude', { encoding: 'utf-8' }).trim();
      logger.debug({ bin: this.cachedBin }, 'claude.resolve: found via which');
      return this.cachedBin;
    } catch {
      this.cachedBin = 'claude';
      logger.debug({ bin: this.cachedBin }, 'claude.resolve: fallback');
      return this.cachedBin;
    }
  }

  async buildArgs(options: AdapterSpawnOptions): Promise<string[]> {
    const isResume = await this.sessionExists(options.sessionId);

    const args: string[] = [
      '-p', options.prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
    ];

    if (isResume) {
      args.push('--resume', options.sessionId);
    } else {
      args.push('--session-id', options.sessionId);
    }

    // Check for MCP config in workspace
    const mcpConfigPath = join(options.workspace, '.mcp.json');
    try {
      await access(mcpConfigPath);
      args.push('--mcp-config', mcpConfigPath);
    } catch {
      // No MCP config
    }

    if (options.model || config.defaultModel) {
      args.push('--model', options.model || config.defaultModel!);
    }

    if (options.maxTurns || config.defaultMaxTurns) {
      args.push('--max-turns', String(options.maxTurns || config.defaultMaxTurns));
    }

    if (options.allowedTools && options.allowedTools.length > 0) {
      args.push('--allowedTools', options.allowedTools.join(' '));
    }

    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }

    return args;
  }

  buildEnv(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {
      CI: '1',
      DISABLE_AUTOUPDATER: '1',
      // Remove vars that prevent Claude CLI from running inside another Claude session
      CLAUDECODE: undefined,
      CLAUDE_CODE_ENTRYPOINT: undefined,
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: undefined,
    };

    // Support ANTHROPIC_AUTH_TOKEN as alias
    if (!process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_AUTH_TOKEN) {
      env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_AUTH_TOKEN;
    }

    return env;
  }

  normalizeEvent(raw: Record<string, unknown>): CliEvent | null {
    // Claude's NDJSON events are already in our standard format
    if (!raw.type || typeof raw.type !== 'string') return null;
    return raw as unknown as CliEvent;
  }

  async sessionExists(sessionId: string): Promise<boolean> {
    const projectsDir = join(process.env.HOME || '/home/node', '.claude', 'projects');
    try {
      const subdirs = await readdir(projectsDir);
      for (const sub of subdirs) {
        try {
          await access(join(projectsDir, sub, `${sessionId}.jsonl`));
          return true;
        } catch {
          // Not in this subdirectory
        }
      }
    } catch {
      // Projects dir doesn't exist yet
    }
    return false;
  }
}
