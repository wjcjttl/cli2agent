import { describe, it, expect } from 'vitest';
import { MessagesRequestSchema, MessagesResponseSchema, MessagesErrorResponseSchema } from './messages.js';

describe('MessagesRequestSchema', () => {
  it('accepts minimal valid request', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts request with all optional fields', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: 'You are helpful.',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' },
      ],
      stream: true,
      thinking: { type: 'enabled', budget_tokens: 5000 },
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      stop_sequences: ['STOP'],
      metadata: { session_id: 'sess-123' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts array content blocks in messages', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
      }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing model', () => {
    const result = MessagesRequestSchema.safeParse({
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing max_tokens', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing messages', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty messages array', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid role in messages', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'system', content: 'Hello' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects max_tokens of 0', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 0,
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative max_tokens', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: -1,
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer max_tokens', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024.5,
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects temperature above 1', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects temperature below 0', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts temperature of 0', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts temperature of 1', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid thinking config', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
      thinking: { type: 'disabled' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects thinking with zero budget_tokens', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
      thinking: { type: 'enabled', budget_tokens: 0 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts metadata with extra fields (passthrough)', () => {
    const result = MessagesRequestSchema.safeParse({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{ role: 'user', content: 'Hello' }],
      metadata: { session_id: 'sess-1', custom_field: 'value' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data.metadata as any).custom_field).toBe('value');
    }
  });
});

describe('MessagesResponseSchema', () => {
  it('accepts valid response', () => {
    const result = MessagesResponseSchema.safeParse({
      id: 'msg_abc123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello!' }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts response with thinking content', () => {
    const result = MessagesResponseSchema.safeParse({
      id: 'msg_abc123',
      type: 'message',
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Let me think...' },
        { type: 'text', text: 'Here is my answer.' },
      ],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(result.success).toBe(true);
  });

  it('accepts null stop_reason', () => {
    const result = MessagesResponseSchema.safeParse({
      id: 'msg_abc123',
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'Incomplete...' }],
      model: 'claude-sonnet-4-6',
      stop_reason: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = MessagesResponseSchema.safeParse({
      id: 'msg_abc123',
      type: 'error',
      role: 'assistant',
      content: [],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(result.success).toBe(false);
  });
});

describe('MessagesErrorResponseSchema', () => {
  it('accepts valid error response', () => {
    const result = MessagesErrorResponseSchema.safeParse({
      type: 'error',
      error: {
        type: 'api_error',
        message: 'Something went wrong',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing error field', () => {
    const result = MessagesErrorResponseSchema.safeParse({
      type: 'error',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-error type', () => {
    const result = MessagesErrorResponseSchema.safeParse({
      type: 'message',
      error: { type: 'api_error', message: 'fail' },
    });
    expect(result.success).toBe(false);
  });
});
