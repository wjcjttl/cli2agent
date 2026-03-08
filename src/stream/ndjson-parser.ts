import { createInterface } from 'readline';
import type { Readable } from 'stream';
import type { CliEvent } from '../types/cli-events.js';
import type { CliAdapter } from '../adapters/types.js';
import { logger } from '../services/logger.js';

export interface NdjsonParserCallbacks {
  onEvent: (event: CliEvent) => void;
  onError: (err: Error) => void;
  onEnd: () => void;
}

/**
 * Parse NDJSON lines from a Claude Code CLI stdout stream.
 * Each line is a self-contained JSON object.
 * Returns a cleanup function to stop parsing.
 */
export function parseNdjsonStream(
  stream: Readable,
  callbacks: NdjsonParserCallbacks,
): () => void {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const event = JSON.parse(trimmed) as CliEvent;
      callbacks.onEvent(event);
    } catch {
      callbacks.onError(new Error(`Failed to parse NDJSON: ${trimmed.slice(0, 200)}`));
    }
  });

  rl.on('close', callbacks.onEnd);
  rl.on('error', callbacks.onError);

  return () => rl.close();
}

/**
 * Async generator that yields parsed CLI events from an NDJSON stream.
 * If an adapter is provided, events are normalized through adapter.normalizeEvent().
 * Events that the adapter returns null for are skipped.
 */
export async function* iterateNdjsonStream(stream: Readable, adapter?: CliAdapter): AsyncGenerator<CliEvent> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const raw = JSON.parse(trimmed);
      if (adapter) {
        try {
          const normalized = adapter.normalizeEvent(raw);
          if (normalized) yield normalized;
        } catch (normalizeErr) {
          logger.debug({ error: normalizeErr instanceof Error ? normalizeErr.message : 'unknown' }, 'ndjson.normalize.skip');
        }
      } else {
        yield raw as CliEvent;
      }
    } catch {
      logger.debug({ line: trimmed.slice(0, 200) }, 'ndjson.parse.skip');
    }
  }
}
