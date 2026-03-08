import type { CliEvent } from '../types/cli-events.js';

/**
 * Options passed to every CLI adapter when spawning a process.
 */
export interface AdapterSpawnOptions {
  prompt: string;
  sessionId: string;
  workspace: string;
  model?: string;
  maxTurns?: number;
  allowedTools?: string[];
  systemPrompt?: string;
}

/**
 * Interface that every CLI backend must implement.
 *
 * Adapters translate between cli2agent's common process model
 * and the specifics of each CLI tool (binary name, flags,
 * environment variables, and streaming event format).
 */
export interface CliAdapter {
  /** Human-readable name, e.g. "claude", "gemini", "codex" */
  readonly name: string;

  /**
   * Resolve the CLI binary path.
   * Returns the full path when resolvable, otherwise falls back to the bare
   * binary name (letting the OS PATH resolve it at spawn time).
   */
  resolveBinary(): string;

  /** Build the CLI arguments array for a headless streaming execution. */
  buildArgs(options: AdapterSpawnOptions): Promise<string[]>;

  /**
   * Build environment variable overrides for the subprocess.
   * Returns a partial env object that is merged with process.env.
   */
  buildEnv(): Record<string, string | undefined>;

  /**
   * Normalize a parsed JSON line from the CLI's stdout into our standard CliEvent.
   * Returns null if the line should be skipped (e.g., CLI diagnostics).
   */
  normalizeEvent(raw: Record<string, unknown>): CliEvent | null;

  /**
   * Check whether a session file already exists for this CLI.
   * Used to decide between "new session" and "resume session" flags.
   */
  sessionExists(sessionId: string): Promise<boolean>;
}

/** Supported CLI backend identifiers */
export type CliBackend = 'claude' | 'codex' | 'gemini' | 'opencode' | 'kimi';
