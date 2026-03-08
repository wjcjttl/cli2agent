import { spawn, type ChildProcess } from 'child_process';
import { config } from '../config.js';
import { logger } from './logger.js';
import { getAdapter, type CliAdapter } from '../adapters/index.js';

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
  adapter: CliAdapter;
  kill: (signal?: NodeJS.Signals) => void;
}

/**
 * Spawn a CLI subprocess in non-interactive streaming mode.
 * Uses the adapter selected by CLI2AGENT_CLI_BACKEND config.
 */
export async function spawnCliProcess(options: CliSpawnOptions): Promise<CliProcessHandle> {
  const adapter = getAdapter(config.cliBackend);
  const bin = adapter.resolveBinary();
  const cwd = options.workspace || config.workspace;
  const args = await adapter.buildArgs({
    ...options,
    workspace: cwd,
  });
  const envOverrides = adapter.buildEnv();

  // Build subprocess environment
  const env = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  logger.info({ sessionId: options.sessionId, backend: adapter.name, bin, cwd, argCount: args.length }, 'cli.spawn');

  const proc = spawn(bin, args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  const startedAt = new Date();

  // Close stdin immediately — no interactive input needed
  proc.stdin.end();

  // Log stderr output at warn level
  proc.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      logger.warn({ sessionId: options.sessionId, backend: adapter.name, stderr: text }, 'cli.stderr');
    }
  });

  // Handle spawn errors (e.g. ENOENT)
  proc.on('error', (err) => {
    logger.error({ sessionId: options.sessionId, backend: adapter.name, err }, 'cli.spawn.error');
    proc.stderr?.push(`${err.message}\n`);
    proc.stdout?.push(null);
  });

  // Log process exit
  proc.on('exit', (code, signal) => {
    const durationMs = Date.now() - startedAt.getTime();
    logger.info({ sessionId: options.sessionId, backend: adapter.name, code, signal, durationMs }, 'cli.exit');
  });

  return {
    process: proc,
    sessionId: options.sessionId,
    startedAt,
    adapter,
    kill: (signal: NodeJS.Signals = 'SIGTERM') => {
      if (!proc.killed) {
        proc.kill(signal);
      }
    },
  };
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
