import { createInterface } from 'readline';
import type { Readable } from 'stream';
import type { CliEvent } from '../types/cli-events.js';

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
 */
export async function* iterateNdjsonStream(stream: Readable): AsyncGenerator<CliEvent> {
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      yield JSON.parse(trimmed) as CliEvent;
    } catch {
      // Skip unparseable lines — CLI may emit non-JSON diagnostics
    }
  }
}
