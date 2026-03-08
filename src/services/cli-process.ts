import { execSync, spawn, type ChildProcess } from 'child_process';
import { access, readdir } from 'fs/promises';
import { join } from 'path';
import { config } from '../config.js';

export interface CliSpawnOptions {
  prompt: string;
  sessionId: string;
  workspace?: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];
  systemPrompt?: string;
}

export interface CliProcessHandle {
  process: ChildProcess;
  sessionId: string;
  startedAt: Date;
  kill: (signal?: NodeJS.Signals) => void;
}

/** Resolve the full path to the `claude` binary once at startup */
let claudePath: string | undefined;
function resolveClaudePath(): string {
  if (claudePath) return claudePath;

  // Check env override first
  if (process.env.CLAUDE_BIN) {
    claudePath = process.env.CLAUDE_BIN;
    return claudePath;
  }

  // Try to find it via shell (respects user's PATH/profile)
  try {
    claudePath = execSync('which claude', { encoding: 'utf-8' }).trim();
    return claudePath;
  } catch {
    // Fallback: assume it's in global node_modules
    claudePath = 'claude';
    return claudePath;
  }
}

/**
 * Spawn a Claude Code CLI subprocess in non-interactive streaming mode.
 */
export async function spawnCliProcess(options: CliSpawnOptions): Promise<CliProcessHandle> {
  const args = await buildCliArgs(options);
  const cwd = options.workspace || config.workspace;
  const bin = resolveClaudePath();

  // Remove env vars that prevent Claude CLI from running inside another Claude session
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS;

  // Support ANTHROPIC_AUTH_TOKEN as alias for ANTHROPIC_API_KEY
  if (!env.ANTHROPIC_API_KEY && env.ANTHROPIC_AUTH_TOKEN) {
    env.ANTHROPIC_API_KEY = env.ANTHROPIC_AUTH_TOKEN;
  }

  const proc = spawn(bin, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...env,
      // Ensure CLI doesn't try to open interactive prompts
      CI: '1',
      DISABLE_AUTOUPDATER: '1',
    },
  });

  // Close stdin immediately — no interactive input needed
  proc.stdin.end();

  // Handle spawn errors (e.g. ENOENT) by emitting on stderr and closing stdout
  proc.on('error', (err) => {
    proc.stderr?.push(`${err.message}\n`);
    proc.stdout?.push(null);
  });

  return {
    process: proc,
    sessionId: options.sessionId,
    startedAt: new Date(),
    kill: (signal: NodeJS.Signals = 'SIGTERM') => {
      if (!proc.killed) {
        proc.kill(signal);
      }
    },
  };
}

async function buildCliArgs(options: CliSpawnOptions): Promise<string[]> {
  const isResume = await sessionFileExists(options.sessionId);

  const args: string[] = [
    '-p', options.prompt,
    '--output-format', 'stream-json',
    '--verbose',  // Required by CLI v2.1.70+ for stream-json output
    '--dangerously-skip-permissions',
  ];

  // For new sessions, use --session-id to create a deterministic session file.
  // For existing sessions, use --resume to continue the conversation.
  if (isResume) {
    args.push('--resume', options.sessionId);
  } else {
    args.push('--session-id', options.sessionId);
  }

  // Check for MCP config in workspace
  const workspace = options.workspace || config.workspace;
  const mcpConfigPath = join(workspace, '.mcp.json');
  try {
    await access(mcpConfigPath);
    args.push('--mcp-config', mcpConfigPath);
  } catch {
    // No MCP config file - continue without it
  }

  // Note: --include-partial-messages suppresses stdout in CLI v2.1.70 with stream-json.
  // Disabled until upstream fix. Partial message events are not critical for operation.

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

/**
 * Check if a session JSONL file exists in any project subdirectory.
 * The CLI stores sessions at ~/.claude/projects/<hash>/<session-id>.jsonl.
 */
async function sessionFileExists(sessionId: string): Promise<boolean> {
  const projectsDir = join(process.env.HOME || '/home/agent', '.claude', 'projects');
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

/**
 * Gracefully kill a CLI process: SIGTERM, then SIGKILL after timeout.
 */
export function gracefulKill(handle: CliProcessHandle, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    if (handle.process.killed || handle.process.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      if (!handle.process.killed) {
        handle.process.kill('SIGKILL');
      }
      resolve();
    }, timeoutMs);

    handle.process.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });

    handle.kill('SIGTERM');
  });
}
