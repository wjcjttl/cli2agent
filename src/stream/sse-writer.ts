import type { FastifyReply } from 'fastify';

/**
 * Wraps a Fastify reply to write SSE events with proper formatting.
 * Handles backpressure via drain events.
 */
export class SseWriter {
  private closed = false;

  constructor(private reply: FastifyReply) {}

  /** Initialize SSE response headers */
  init(): void {
    this.reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  }

  /** Write a typed SSE event */
  async write(event: string, data: unknown): Promise<void> {
    if (this.closed) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const canContinue = this.reply.raw.write(payload);

    if (!canContinue) {
      await new Promise<void>((resolve) => this.reply.raw.once('drain', resolve));
    }
  }

  /** Send a ping/keepalive */
  async ping(): Promise<void> {
    await this.write('ping', { type: 'ping' });
  }

  /** End the SSE stream */
  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.reply.raw.end();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Mark as closed (e.g. when client disconnects) */
  markClosed(): void {
    this.closed = true;
  }
}
