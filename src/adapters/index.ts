import type { CliAdapter, CliBackend } from './types.js';
import { ClaudeAdapter } from './claude.js';
import { CodexAdapter } from './codex.js';
import { GeminiAdapter } from './gemini.js';
import { OpenCodeAdapter } from './opencode.js';
import { KimiAdapter } from './kimi.js';

export type { CliAdapter, CliBackend, AdapterSpawnOptions } from './types.js';

const adapters: Record<CliBackend, () => CliAdapter> = {
  claude: () => new ClaudeAdapter(),
  codex: () => new CodexAdapter(),
  gemini: () => new GeminiAdapter(),
  opencode: () => new OpenCodeAdapter(),
  kimi: () => new KimiAdapter(),
};

/** Singleton adapter instances, lazily created */
const instances = new Map<CliBackend, CliAdapter>();

/**
 * Get the adapter for the specified backend.
 * Creates and caches the instance on first call.
 */
export function getAdapter(backend: CliBackend): CliAdapter {
  let adapter = instances.get(backend);
  if (!adapter) {
    const factory = adapters[backend];
    if (!factory) {
      throw new Error(`Unknown CLI backend: ${backend}. Supported: ${Object.keys(adapters).join(', ')}`);
    }
    adapter = factory();
    instances.set(backend, adapter);
  }
  return adapter;
}

/** List all supported backend names */
export const supportedBackends: CliBackend[] = Object.keys(adapters) as CliBackend[];
