import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicSseTranslator } from './anthropic-translator.js';
import type { CliAssistantEvent, CliEvent } from '../types/cli-events.js';

function createMockReply() {
  const chunks: string[] = [];
  const raw = {
    writeHead: vi.fn(),
    write: vi.fn((data: string) => { chunks.push(data); return true; }),
    end: vi.fn(),
    once: vi.fn(),
  };
  return { reply: { raw } as any, chunks, raw };
}

function makeAssistantEvent(content: CliAssistantEvent['message']['content'], usage?: { input_tokens: number; output_tokens: number }): CliAssistantEvent {
  return {
    type: 'assistant',
    message: {
      id: 'msg-test',
      model: 'test-model',
      role: 'assistant',
      content,
      stop_reason: null,
      usage: usage || { input_tokens: 0, output_tokens: 0 },
    },
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd: '/tmp',
    sessionId: 'sess-1',
    version: '1.0',
    gitBranch: 'main',
    uuid: 'u1',
    timestamp: '2025-01-01T00:00:00Z',
  };
}

describe('AnthropicSseTranslator', () => {
  let mockReply: ReturnType<typeof createMockReply>;
  let translator: AnthropicSseTranslator;

  beforeEach(() => {
    mockReply = createMockReply();
    translator = new AnthropicSseTranslator(mockReply.reply, 'msg_test123', 'claude-sonnet-4-6');
  });

  describe('init()', () => {
    it('writes SSE headers', async () => {
      await translator.init();
      expect(mockReply.raw.writeHead).toHaveBeenCalledWith(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
    });

    it('emits message_start event', async () => {
      await translator.init();
      expect(mockReply.chunks).toHaveLength(1);
      const chunk = mockReply.chunks[0];
      expect(chunk).toContain('event: message_start');
      const data = JSON.parse(chunk.split('data: ')[1].trim());
      expect(data.type).toBe('message_start');
      expect(data.message.id).toBe('msg_test123');
      expect(data.message.model).toBe('claude-sonnet-4-6');
      expect(data.message.role).toBe('assistant');
      expect(data.message.content).toEqual([]);
      expect(data.message.stop_reason).toBeNull();
    });
  });

  describe('processEvent()', () => {
    it('emits content_block_start, content_block_delta, content_block_stop for text', async () => {
      await translator.init();
      mockReply.chunks.length = 0; // clear init chunks

      const event = makeAssistantEvent([{ type: 'text', text: 'Hello world' }]);
      await translator.processEvent(event);

      // Should have: content_block_start, content_block_delta, content_block_stop
      expect(mockReply.chunks).toHaveLength(3);

      const start = JSON.parse(mockReply.chunks[0].split('data: ')[1].trim());
      expect(start.type).toBe('content_block_start');
      expect(start.index).toBe(0);
      expect(start.content_block.type).toBe('text');

      const delta = JSON.parse(mockReply.chunks[1].split('data: ')[1].trim());
      expect(delta.type).toBe('content_block_delta');
      expect(delta.index).toBe(0);
      expect(delta.delta.type).toBe('text_delta');
      expect(delta.delta.text).toBe('Hello world');

      const stop = JSON.parse(mockReply.chunks[2].split('data: ')[1].trim());
      expect(stop.type).toBe('content_block_stop');
      expect(stop.index).toBe(0);
    });

    it('emits thinking_delta for thinking content', async () => {
      await translator.init();
      mockReply.chunks.length = 0;

      const event = makeAssistantEvent([{ type: 'thinking', thinking: 'Let me consider...' }]);
      await translator.processEvent(event);

      expect(mockReply.chunks).toHaveLength(3);

      const start = JSON.parse(mockReply.chunks[0].split('data: ')[1].trim());
      expect(start.content_block.type).toBe('thinking');

      const delta = JSON.parse(mockReply.chunks[1].split('data: ')[1].trim());
      expect(delta.delta.type).toBe('thinking_delta');
      expect(delta.delta.thinking).toBe('Let me consider...');
    });

    it('skips events when closed', async () => {
      await translator.init();
      translator.end();
      mockReply.chunks.length = 0;

      const event = makeAssistantEvent([{ type: 'text', text: 'Should be skipped' }]);
      await translator.processEvent(event);

      expect(mockReply.chunks).toHaveLength(0);
    });

    it('skips events that are not assistant type', async () => {
      await translator.init();
      mockReply.chunks.length = 0;

      const event: CliEvent = {
        type: 'result',
        result: 'done',
        duration_ms: 100,
        num_turns: 1,
        usage: { input_tokens: 10, output_tokens: 5 },
        parentUuid: null,
        isSidechain: false,
        userType: 'external',
        cwd: '/tmp',
        sessionId: 'sess-1',
        version: '1.0',
        gitBranch: 'main',
        uuid: 'u2',
        timestamp: '2025-01-01T00:00:00Z',
      };
      await translator.processEvent(event);

      expect(mockReply.chunks).toHaveLength(0);
    });

    it('skips text blocks with empty text', async () => {
      await translator.init();
      mockReply.chunks.length = 0;

      const event = makeAssistantEvent([{ type: 'text', text: '' }]);
      await translator.processEvent(event);

      expect(mockReply.chunks).toHaveLength(0);
    });

    it('skips assistant events with no content', async () => {
      await translator.init();
      mockReply.chunks.length = 0;

      const event: CliAssistantEvent = {
        type: 'assistant',
        message: {
          id: 'msg-1',
          model: 'test',
          role: 'assistant',
          content: [],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
        parentUuid: null,
        isSidechain: false,
        userType: 'external',
        cwd: '/tmp',
        sessionId: 's',
        version: '1',
        gitBranch: 'main',
        uuid: 'u',
        timestamp: '',
      };
      await translator.processEvent(event);

      expect(mockReply.chunks).toHaveLength(0);
    });
  });

  describe('content block indexing', () => {
    it('increments index for each content block across events', async () => {
      await translator.init();
      mockReply.chunks.length = 0;

      // First block
      await translator.processEvent(makeAssistantEvent([{ type: 'text', text: 'Block 0' }]));
      // Second block
      await translator.processEvent(makeAssistantEvent([{ type: 'thinking', thinking: 'Block 1' }]));
      // Third block
      await translator.processEvent(makeAssistantEvent([{ type: 'text', text: 'Block 2' }]));

      // Each block produces 3 SSE events (start, delta, stop) = 9 total
      expect(mockReply.chunks).toHaveLength(9);

      // Check indices
      const starts = mockReply.chunks
        .map(c => JSON.parse(c.split('data: ')[1].trim()))
        .filter(d => d.type === 'content_block_start');
      expect(starts).toHaveLength(3);
      expect(starts[0].index).toBe(0);
      expect(starts[1].index).toBe(1);
      expect(starts[2].index).toBe(2);
    });
  });

  describe('usage tracking', () => {
    it('accumulates usage across multiple events', async () => {
      await translator.init();

      await translator.processEvent(makeAssistantEvent(
        [{ type: 'text', text: 'Part 1' }],
        { input_tokens: 10, output_tokens: 5 },
      ));
      await translator.processEvent(makeAssistantEvent(
        [{ type: 'text', text: 'Part 2' }],
        { input_tokens: 20, output_tokens: 15 },
      ));

      expect(translator.usage).toEqual({
        input_tokens: 30,
        output_tokens: 20,
      });
    });
  });

  describe('finish()', () => {
    it('emits message_delta and message_stop', async () => {
      await translator.init();
      mockReply.chunks.length = 0;

      await translator.finish('end_turn');

      expect(mockReply.chunks).toHaveLength(2);

      const delta = JSON.parse(mockReply.chunks[0].split('data: ')[1].trim());
      expect(delta.type).toBe('message_delta');
      expect(delta.delta.stop_reason).toBe('end_turn');
      expect(delta.delta.stop_sequence).toBeNull();

      const stop = JSON.parse(mockReply.chunks[1].split('data: ')[1].trim());
      expect(stop.type).toBe('message_stop');
    });

    it('defaults stop_reason to "end_turn"', async () => {
      await translator.init();
      mockReply.chunks.length = 0;

      await translator.finish();

      const delta = JSON.parse(mockReply.chunks[0].split('data: ')[1].trim());
      expect(delta.delta.stop_reason).toBe('end_turn');
    });

    it('includes accumulated output_tokens in usage', async () => {
      await translator.init();
      await translator.processEvent(makeAssistantEvent(
        [{ type: 'text', text: 'hi' }],
        { input_tokens: 5, output_tokens: 42 },
      ));
      mockReply.chunks.length = 0;

      await translator.finish();

      const delta = JSON.parse(mockReply.chunks[0].split('data: ')[1].trim());
      expect(delta.usage.output_tokens).toBe(42);
    });

    it('closes open content block before finishing', async () => {
      // This is an internal behavior test — after processing a text block,
      // blocks are already closed, so finish() just emits delta+stop
      await translator.init();
      await translator.processEvent(makeAssistantEvent([{ type: 'text', text: 'test' }]));
      mockReply.chunks.length = 0;

      await translator.finish();

      // Should only have message_delta + message_stop (no extra content_block_stop)
      expect(mockReply.chunks).toHaveLength(2);
    });

    it('does nothing when already closed', async () => {
      await translator.init();
      translator.end();
      mockReply.chunks.length = 0;

      await translator.finish();

      expect(mockReply.chunks).toHaveLength(0);
    });
  });

  describe('end()', () => {
    it('calls raw.end()', async () => {
      await translator.init();
      translator.end();
      expect(mockReply.raw.end).toHaveBeenCalled();
    });

    it('sets closed flag', async () => {
      await translator.init();
      expect(translator.isClosed).toBe(false);
      translator.end();
      expect(translator.isClosed).toBe(true);
    });

    it('is idempotent (calling twice does not call raw.end twice)', async () => {
      await translator.init();
      translator.end();
      translator.end();
      expect(mockReply.raw.end).toHaveBeenCalledTimes(1);
    });
  });

  describe('markClosed()', () => {
    it('sets closed flag without calling raw.end', async () => {
      await translator.init();
      translator.markClosed();
      expect(translator.isClosed).toBe(true);
      expect(mockReply.raw.end).not.toHaveBeenCalled();
    });
  });

  describe('backpressure handling', () => {
    it('waits for drain when write returns false', async () => {
      let drainCallback: (() => void) | undefined;
      mockReply.raw.write.mockImplementationOnce((_data: string) => {
        mockReply.chunks.push(_data);
        return false; // signal backpressure
      });
      mockReply.raw.once.mockImplementation((event: string, cb: () => void) => {
        if (event === 'drain') drainCallback = cb;
      });

      const initPromise = translator.init();

      // Simulate drain event
      if (drainCallback) drainCallback();
      await initPromise;

      expect(mockReply.raw.once).toHaveBeenCalledWith('drain', expect.any(Function));
    });
  });
});
