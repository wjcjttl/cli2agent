import type { FastifyReply } from 'fastify';
import type { CliAssistantEvent, CliEvent } from '../types/cli-events.js';

/**
 * Translates CLI NDJSON events into Anthropic Messages API SSE format.
 *
 * Anthropic SSE events:
 *   message_start → content_block_start → content_block_delta* → content_block_stop → message_delta → message_stop
 *
 * This is a stateful translator that tracks content block indices.
 */
export class AnthropicSseTranslator {
  private closed = false;
  private contentBlockIndex = 0;
  private blockOpen = false;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  constructor(
    private reply: FastifyReply,
    private messageId: string,
    private model: string,
  ) {}

  /** Initialize SSE response headers and emit message_start */
  async init(): Promise<void> {
    this.reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    await this.writeEvent('message_start', {
      type: 'message_start',
      message: {
        id: this.messageId,
        type: 'message',
        role: 'assistant',
        content: [],
        model: this.model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 1,
        },
      },
    });
  }

  /** Process a CLI event and emit corresponding Anthropic SSE events */
  async processEvent(event: CliEvent): Promise<void> {
    if (this.closed) return;

    if (event.type === 'assistant') {
      const assistantEvent = event as CliAssistantEvent;
      const msg = assistantEvent.message;

      // Track usage
      if (msg?.usage) {
        this.totalInputTokens += msg.usage.input_tokens || 0;
        this.totalOutputTokens += msg.usage.output_tokens || 0;
      }

      if (!msg?.content) return;

      for (const block of msg.content) {
        if (block.type === 'text' && block.text) {
          // Close previous block if open and different type might apply
          if (this.blockOpen) {
            await this.closeContentBlock();
          }
          await this.openContentBlock({ type: 'text', text: '' });
          await this.writeEvent('content_block_delta', {
            type: 'content_block_delta',
            index: this.contentBlockIndex,
            delta: {
              type: 'text_delta',
              text: block.text,
            },
          });
          await this.closeContentBlock();
        } else if (block.type === 'thinking' && block.thinking) {
          if (this.blockOpen) {
            await this.closeContentBlock();
          }
          await this.openContentBlock({ type: 'thinking', thinking: '' });
          await this.writeEvent('content_block_delta', {
            type: 'content_block_delta',
            index: this.contentBlockIndex,
            delta: {
              type: 'thinking_delta',
              thinking: block.thinking,
            },
          });
          await this.closeContentBlock();
        }
        // tool_use blocks are not translated to Anthropic format for now
      }
    }
    // Skip other event types (progress, tool_result, user, etc.)
  }

  /** Finalize the stream with message_delta and message_stop */
  async finish(stopReason: string = 'end_turn'): Promise<void> {
    if (this.closed) return;

    // Close any open content block
    if (this.blockOpen) {
      await this.closeContentBlock();
    }

    await this.writeEvent('message_delta', {
      type: 'message_delta',
      delta: {
        stop_reason: stopReason,
        stop_sequence: null,
      },
      usage: {
        output_tokens: this.totalOutputTokens,
      },
    });

    await this.writeEvent('message_stop', {
      type: 'message_stop',
    });
  }

  /** End the stream */
  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.reply.raw.end();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  markClosed(): void {
    this.closed = true;
  }

  get usage(): { input_tokens: number; output_tokens: number } {
    return {
      input_tokens: this.totalInputTokens,
      output_tokens: this.totalOutputTokens,
    };
  }

  private async openContentBlock(contentBlock: Record<string, unknown>): Promise<void> {
    await this.writeEvent('content_block_start', {
      type: 'content_block_start',
      index: this.contentBlockIndex,
      content_block: contentBlock,
    });
    this.blockOpen = true;
  }

  private async closeContentBlock(): Promise<void> {
    await this.writeEvent('content_block_stop', {
      type: 'content_block_stop',
      index: this.contentBlockIndex,
    });
    this.blockOpen = false;
    this.contentBlockIndex++;
  }

  private async writeEvent(event: string, data: unknown): Promise<void> {
    if (this.closed) return;

    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const canContinue = this.reply.raw.write(payload);

    if (!canContinue) {
      await new Promise<void>((resolve) => this.reply.raw.once('drain', resolve));
    }
  }
}
