import { describe, it, expect, beforeEach } from 'vitest';
import { GeminiAdapter } from './gemini.js';
import { CodexAdapter } from './codex.js';
import { OpenCodeAdapter } from './opencode.js';
import { KimiAdapter } from './kimi.js';
import { ClaudeAdapter } from './claude.js';
import { getAdapter, supportedBackends } from './index.js';
import type { AdapterSpawnOptions } from './types.js';

// ─── GeminiAdapter ──────────────────────────────────────────────────────────

describe('GeminiAdapter', () => {
  let adapter: GeminiAdapter;
  beforeEach(() => { adapter = new GeminiAdapter(); });

  it('has name "gemini"', () => {
    expect(adapter.name).toBe('gemini');
  });

  describe('normalizeEvent', () => {
    it('returns null for events without a type', () => {
      expect(adapter.normalizeEvent({ foo: 'bar' })).toBeNull();
    });

    it('skips init events', () => {
      expect(adapter.normalizeEvent({ type: 'init', session_id: 'abc' })).toBeNull();
    });

    it('normalizes message events to assistant', () => {
      const result = adapter.normalizeEvent({
        type: 'message',
        role: 'assistant',
        id: 'msg-1',
        model: 'gemini-pro',
        content: [{ type: 'text', text: 'Hello world' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('assistant');
      const msg = (result as any).message;
      expect(msg.role).toBe('assistant');
      expect(msg.content).toHaveLength(1);
      expect(msg.content[0].type).toBe('text');
      expect(msg.content[0].text).toBe('Hello world');
      expect(msg.usage.input_tokens).toBe(10);
      expect(msg.usage.output_tokens).toBe(5);
    });

    it('normalizes message with string content', () => {
      const result = adapter.normalizeEvent({
        type: 'message',
        role: 'assistant',
        content: 'Just a string',
      });
      expect(result).not.toBeNull();
      const msg = (result as any).message;
      expect(msg.content).toEqual([{ type: 'text', text: 'Just a string' }]);
    });

    it('returns null for non-assistant message events', () => {
      const result = adapter.normalizeEvent({
        type: 'message',
        role: 'user',
        content: 'user message',
      });
      expect(result).toBeNull();
    });

    it('normalizes tool_use events', () => {
      const result = adapter.normalizeEvent({
        type: 'tool_use',
        id: 'tool-1',
        name: 'read_file',
        input: { path: '/tmp/test.txt' },
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('assistant');
      const content = (result as any).message.content;
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe('tool_use');
      expect(content[0].id).toBe('tool-1');
      expect(content[0].name).toBe('read_file');
      expect(content[0].input).toEqual({ path: '/tmp/test.txt' });
    });

    it('normalizes tool_use with "tool" field as fallback name', () => {
      const result = adapter.normalizeEvent({
        type: 'tool_use',
        id: 'tool-2',
        tool: 'write_file',
        input: {},
      });
      const content = (result as any).message.content;
      expect(content[0].name).toBe('write_file');
    });

    it('normalizes error events', () => {
      const result = adapter.normalizeEvent({
        type: 'error',
        message: 'Something went wrong',
        error_type: 'rate_limit',
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('error');
      const err = (result as any).error;
      expect(err.type).toBe('rate_limit');
      expect(err.message).toBe('Something went wrong');
    });

    it('normalizes error events with "error" field fallback', () => {
      const result = adapter.normalizeEvent({
        type: 'error',
        error: 'Fallback error text',
      });
      const err = (result as any).error;
      expect(err.message).toBe('Fallback error text');
    });

    it('normalizes result events', () => {
      const result = adapter.normalizeEvent({
        type: 'result',
        response: 'Final response',
        duration_ms: 1234,
        num_turns: 3,
        usage: { input_tokens: 100, output_tokens: 50 },
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('result');
      expect((result as any).result).toBe('Final response');
      expect((result as any).duration_ms).toBe(1234);
      expect((result as any).num_turns).toBe(3);
      expect((result as any).usage.input_tokens).toBe(100);
    });

    it('normalizes result events with stats fallback for usage', () => {
      const result = adapter.normalizeEvent({
        type: 'result',
        response: 'Done',
        stats: { input_tokens: 20, output_tokens: 10 },
      });
      expect((result as any).usage.input_tokens).toBe(20);
    });

    it('normalizes tool_result events', () => {
      const result = adapter.normalizeEvent({
        type: 'tool_result',
        output: 'file contents here',
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('tool_result');
      expect((result as any).toolUseResult).toBe('file contents here');
    });

    it('returns null for unknown event types', () => {
      expect(adapter.normalizeEvent({ type: 'unknown_event' })).toBeNull();
    });

    it('handles missing content gracefully', () => {
      const result = adapter.normalizeEvent({
        type: 'message',
        role: 'assistant',
      });
      expect(result).not.toBeNull();
      const msg = (result as any).message;
      expect(msg.content).toEqual([]);
    });
  });
});

// ─── CodexAdapter ───────────────────────────────────────────────────────────

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;
  beforeEach(() => { adapter = new CodexAdapter(); });

  it('has name "codex"', () => {
    expect(adapter.name).toBe('codex');
  });

  describe('normalizeEvent', () => {
    it('returns null for events without a type', () => {
      expect(adapter.normalizeEvent({})).toBeNull();
    });

    it('normalizes message events with string content', () => {
      const result = adapter.normalizeEvent({
        type: 'message',
        content: 'Hello from Codex',
        id: 'cx-1',
        model: 'o3-mini',
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('assistant');
      const msg = (result as any).message;
      expect(msg.content).toEqual([{ type: 'text', text: 'Hello from Codex' }]);
      expect(msg.id).toBe('cx-1');
    });

    it('normalizes message events with "text" fallback field', () => {
      const result = adapter.normalizeEvent({
        type: 'message',
        text: 'text-field content',
      });
      const msg = (result as any).message;
      expect(msg.content[0].text).toBe('text-field content');
    });

    it('normalizes message events with array content', () => {
      const result = adapter.normalizeEvent({
        type: 'message',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'output_text', text: 'Part 2' },
          'Plain string',
        ],
      });
      const msg = (result as any).message;
      expect(msg.content).toHaveLength(3);
      expect(msg.content[0].text).toBe('Part 1');
      expect(msg.content[1].text).toBe('Part 2');
      expect(msg.content[2].text).toBe('Plain string');
    });

    it('normalizes response events the same as message', () => {
      const result = adapter.normalizeEvent({
        type: 'response',
        content: 'Response text',
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('assistant');
    });

    it('normalizes function_call events to tool_use', () => {
      const result = adapter.normalizeEvent({
        type: 'function_call',
        call_id: 'call-1',
        name: 'shell',
        arguments: { command: 'ls -la' },
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('assistant');
      const content = (result as any).message.content;
      expect(content[0].type).toBe('tool_use');
      expect(content[0].id).toBe('call-1');
      expect(content[0].name).toBe('shell');
      expect(content[0].input).toEqual({ command: 'ls -la' });
    });

    it('normalizes tool_call events to tool_use', () => {
      const result = adapter.normalizeEvent({
        type: 'tool_call',
        id: 'tc-1',
        function: 'read',
        input: { path: '/tmp' },
      });
      const content = (result as any).message.content;
      expect(content[0].type).toBe('tool_use');
      expect(content[0].name).toBe('read');
    });

    it('normalizes function_call_output events', () => {
      const result = adapter.normalizeEvent({
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'file1.txt\nfile2.txt',
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('tool_result');
      expect((result as any).toolUseResult).toBe('file1.txt\nfile2.txt');
      expect((result as any).sourceToolAssistantUUID).toBe('call-1');
    });

    it('normalizes tool_result events', () => {
      const result = adapter.normalizeEvent({
        type: 'tool_result',
        result: 'some result',
      });
      expect(result!.type).toBe('tool_result');
      expect((result as any).toolUseResult).toBe('some result');
    });

    it('normalizes error events', () => {
      const result = adapter.normalizeEvent({
        type: 'error',
        message: 'Codex error',
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('error');
      expect((result as any).error.type).toBe('cli_error');
      expect((result as any).error.message).toBe('Codex error');
    });

    it('normalizes completed events to result', () => {
      const result = adapter.normalizeEvent({
        type: 'completed',
        result: 'Task done',
        duration_ms: 5000,
        num_turns: 2,
        usage: { input_tokens: 200, output_tokens: 100 },
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('result');
      expect((result as any).result).toBe('Task done');
      expect((result as any).duration_ms).toBe(5000);
      expect((result as any).usage.input_tokens).toBe(200);
    });

    it('normalizes done events to result', () => {
      const result = adapter.normalizeEvent({ type: 'done' });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('result');
    });

    it('returns null for unknown event types', () => {
      expect(adapter.normalizeEvent({ type: 'heartbeat' })).toBeNull();
    });
  });
});

// ─── OpenCodeAdapter ────────────────────────────────────────────────────────

describe('OpenCodeAdapter', () => {
  let adapter: OpenCodeAdapter;
  beforeEach(() => { adapter = new OpenCodeAdapter(); });

  it('has name "opencode"', () => {
    expect(adapter.name).toBe('opencode');
  });

  describe('normalizeEvent', () => {
    it('returns null for events without a type', () => {
      expect(adapter.normalizeEvent({})).toBeNull();
    });

    it('normalizes text events to assistant', () => {
      const result = adapter.normalizeEvent({
        type: 'text',
        part: { text: 'Hello from OpenCode' },
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('assistant');
      const msg = (result as any).message;
      expect(msg.content).toEqual([{ type: 'text', text: 'Hello from OpenCode' }]);
    });

    it('normalizes text events with top-level text field', () => {
      const result = adapter.normalizeEvent({
        type: 'text',
        text: 'Top level text',
      });
      const msg = (result as any).message;
      expect(msg.content[0].text).toBe('Top level text');
    });

    it('returns null for text events with empty text', () => {
      const result = adapter.normalizeEvent({
        type: 'text',
        part: { text: '' },
      });
      expect(result).toBeNull();
    });

    it('normalizes reasoning events to thinking content', () => {
      const result = adapter.normalizeEvent({
        type: 'reasoning',
        part: { text: 'Let me think...' },
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('assistant');
      const msg = (result as any).message;
      expect(msg.content).toHaveLength(1);
      expect(msg.content[0].type).toBe('thinking');
      expect(msg.content[0].thinking).toBe('Let me think...');
    });

    it('returns null for reasoning events with empty text', () => {
      expect(adapter.normalizeEvent({ type: 'reasoning' })).toBeNull();
    });

    it('normalizes tool_use events', () => {
      const result = adapter.normalizeEvent({
        type: 'tool_use',
        part: {
          id: 'tu-1',
          tool: 'bash',
          state: { input: { command: 'echo hi' } },
        },
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('assistant');
      const content = (result as any).message.content;
      expect(content[0].type).toBe('tool_use');
      expect(content[0].id).toBe('tu-1');
      expect(content[0].name).toBe('bash');
      expect(content[0].input).toEqual({ command: 'echo hi' });
    });

    it('normalizes tool_use with top-level tool field', () => {
      const result = adapter.normalizeEvent({
        type: 'tool_use',
        tool: 'grep',
      });
      const content = (result as any).message.content;
      expect(content[0].name).toBe('grep');
    });

    it('normalizes error events', () => {
      const result = adapter.normalizeEvent({
        type: 'error',
        error: { message: 'Connection failed' },
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('error');
      expect((result as any).error.message).toBe('Connection failed');
    });

    it('normalizes error events with string error field', () => {
      const result = adapter.normalizeEvent({
        type: 'error',
        error: 'Simple error string',
      });
      expect((result as any).error.message).toBe('Simple error string');
    });

    it('returns null for step_start events', () => {
      expect(adapter.normalizeEvent({ type: 'step_start' })).toBeNull();
    });

    it('returns null for step_finish events', () => {
      expect(adapter.normalizeEvent({ type: 'step_finish' })).toBeNull();
    });
  });
});

// ─── KimiAdapter ────────────────────────────────────────────────────────────

describe('KimiAdapter', () => {
  let adapter: KimiAdapter;
  beforeEach(() => { adapter = new KimiAdapter(); });

  it('has name "kimi"', () => {
    expect(adapter.name).toBe('kimi');
  });

  describe('normalizeEvent', () => {
    it('returns null for events without a type', () => {
      expect(adapter.normalizeEvent({})).toBeNull();
    });

    it('returns null for events with non-string type', () => {
      expect(adapter.normalizeEvent({ type: 123 })).toBeNull();
    });

    it('passes through events with a valid type (passthrough)', () => {
      const event = {
        type: 'assistant',
        message: {
          id: 'msg-1',
          model: 'kimi-k2',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          stop_reason: null,
          usage: { input_tokens: 5, output_tokens: 3 },
        },
        uuid: 'u1',
        timestamp: '2025-01-01T00:00:00Z',
        sessionId: 's1',
      };
      const result = adapter.normalizeEvent(event as Record<string, unknown>);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('assistant');
      // Passthrough means the raw object is returned as-is
      expect((result as any).message.content[0].text).toBe('Hello');
    });

    it('passes through result events', () => {
      const result = adapter.normalizeEvent({
        type: 'result',
        result: 'Done',
        duration_ms: 500,
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('result');
    });
  });
});

// ─── ClaudeAdapter ──────────────────────────────────────────────────────────

describe('ClaudeAdapter', () => {
  let adapter: ClaudeAdapter;
  beforeEach(() => { adapter = new ClaudeAdapter(); });

  it('has name "claude"', () => {
    expect(adapter.name).toBe('claude');
  });

  describe('normalizeEvent', () => {
    it('returns null for events without a type', () => {
      expect(adapter.normalizeEvent({})).toBeNull();
    });

    it('returns null for events with non-string type', () => {
      expect(adapter.normalizeEvent({ type: 42 })).toBeNull();
    });

    it('passes through events with a valid type (passthrough)', () => {
      const event = {
        type: 'assistant',
        message: {
          id: 'msg-1',
          model: 'claude-sonnet-4-6',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hi' }],
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        },
        uuid: 'u1',
        timestamp: '2025-01-01T00:00:00Z',
        sessionId: 's1',
      };
      const result = adapter.normalizeEvent(event as Record<string, unknown>);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('assistant');
    });

    it('passes through error events', () => {
      const result = adapter.normalizeEvent({
        type: 'error',
        error: { type: 'api_error', message: 'fail' },
      });
      expect(result).not.toBeNull();
      expect(result!.type).toBe('error');
    });
  });
});

// ─── Adapter buildArgs / buildEnv / resolveBinary ───────────────────────────

const baseSpawnOptions: AdapterSpawnOptions = {
  prompt: 'Say hello',
  sessionId: 'test-session-123',
  workspace: '/workspace',
  model: 'test-model',
  maxTurns: 5,
  allowedTools: ['Read', 'Bash'],
  systemPrompt: 'Be helpful',
};

describe('ClaudeAdapter buildArgs', () => {
  const adapter = new ClaudeAdapter();

  it('includes -p flag with prompt', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('-p');
    const pIdx = args.indexOf('-p');
    expect(args[pIdx + 1]).toBe('Say hello');
  });

  it('includes --output-format stream-json', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--output-format');
    const idx = args.indexOf('--output-format');
    expect(args[idx + 1]).toBe('stream-json');
  });

  it('includes --dangerously-skip-permissions', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--dangerously-skip-permissions');
  });

  it('includes --model when specified', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--model');
    const idx = args.indexOf('--model');
    expect(args[idx + 1]).toBe('test-model');
  });

  it('includes --max-turns when specified', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--max-turns');
    const idx = args.indexOf('--max-turns');
    expect(args[idx + 1]).toBe('5');
  });

  it('includes --allowedTools when specified', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--allowedTools');
    const idx = args.indexOf('--allowedTools');
    expect(args[idx + 1]).toBe('Read Bash');
  });

  it('includes --system-prompt when specified', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--system-prompt');
    const idx = args.indexOf('--system-prompt');
    expect(args[idx + 1]).toBe('Be helpful');
  });

  it('uses --session-id for new sessions', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--session-id');
    expect(args).not.toContain('--resume');
  });
});

describe('ClaudeAdapter buildEnv', () => {
  const adapter = new ClaudeAdapter();

  it('sets CI=1', () => {
    const env = adapter.buildEnv();
    expect(env.CI).toBe('1');
  });

  it('sets DISABLE_AUTOUPDATER=1', () => {
    const env = adapter.buildEnv();
    expect(env.DISABLE_AUTOUPDATER).toBe('1');
  });

  it('clears CLAUDECODE to prevent nesting detection', () => {
    const env = adapter.buildEnv();
    expect(env.CLAUDECODE).toBeUndefined();
  });
});

describe('GeminiAdapter buildArgs', () => {
  const adapter = new GeminiAdapter();

  it('first arg is the prompt', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args[0]).toBe('Say hello');
  });

  it('includes --output-format stream-json', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--output-format');
    const idx = args.indexOf('--output-format');
    expect(args[idx + 1]).toBe('stream-json');
  });

  it('includes --approval-mode=yolo', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--approval-mode=yolo');
  });

  it('includes --model when specified', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--model');
  });
});

describe('GeminiAdapter buildEnv', () => {
  it('sets CI=1', () => {
    const adapter = new GeminiAdapter();
    expect(adapter.buildEnv().CI).toBe('1');
  });
});

describe('CodexAdapter buildArgs', () => {
  const adapter = new CodexAdapter();

  it('first arg is the prompt', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args[0]).toBe('Say hello');
  });

  it('includes --json flag', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--json');
  });

  it('includes --full-auto flag', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--full-auto');
  });

  it('includes --cd for workspace', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--cd');
    const idx = args.indexOf('--cd');
    expect(args[idx + 1]).toBe('/workspace');
  });

  it('includes --model when specified', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--model');
    const idx = args.indexOf('--model');
    expect(args[idx + 1]).toBe('test-model');
  });
});

describe('OpenCodeAdapter buildArgs', () => {
  const adapter = new OpenCodeAdapter();

  it('starts with "run" subcommand', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args[0]).toBe('run');
  });

  it('includes prompt as second arg', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args[1]).toBe('Say hello');
  });

  it('includes --format json', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--format');
    const idx = args.indexOf('--format');
    expect(args[idx + 1]).toBe('json');
  });

  it('includes --dir for workspace', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--dir');
    const idx = args.indexOf('--dir');
    expect(args[idx + 1]).toBe('/workspace');
  });
});

describe('KimiAdapter buildArgs', () => {
  const adapter = new KimiAdapter();

  it('includes --print flag', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--print');
  });

  it('includes -p flag with prompt', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('-p');
    const idx = args.indexOf('-p');
    expect(args[idx + 1]).toBe('Say hello');
  });

  it('includes --output-format stream-json', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--output-format');
    const idx = args.indexOf('--output-format');
    expect(args[idx + 1]).toBe('stream-json');
  });

  it('includes --yolo flag', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--yolo');
  });

  it('includes --work-dir for workspace', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--work-dir');
    const idx = args.indexOf('--work-dir');
    expect(args[idx + 1]).toBe('/workspace');
  });

  it('includes --max-steps-per-turn for maxTurns', async () => {
    const args = await adapter.buildArgs(baseSpawnOptions);
    expect(args).toContain('--max-steps-per-turn');
    const idx = args.indexOf('--max-steps-per-turn');
    expect(args[idx + 1]).toBe('5');
  });
});

describe('Adapter resolveBinary', () => {
  it('ClaudeAdapter resolves to a non-empty string', () => {
    const adapter = new ClaudeAdapter();
    const bin = adapter.resolveBinary();
    expect(typeof bin).toBe('string');
    expect(bin.length).toBeGreaterThan(0);
  });

  it('GeminiAdapter resolves to "gemini" as fallback', () => {
    const adapter = new GeminiAdapter();
    expect(adapter.resolveBinary()).toContain('gemini');
  });

  it('CodexAdapter resolves to "codex" as fallback', () => {
    const adapter = new CodexAdapter();
    expect(adapter.resolveBinary()).toContain('codex');
  });

  it('OpenCodeAdapter resolves to "opencode" as fallback', () => {
    const adapter = new OpenCodeAdapter();
    expect(adapter.resolveBinary()).toContain('opencode');
  });

  it('KimiAdapter resolves to "kimi" as fallback', () => {
    const adapter = new KimiAdapter();
    expect(adapter.resolveBinary()).toContain('kimi');
  });
});

// ─── supportedBackends ──────────────────────────────────────────────────────

describe('supportedBackends', () => {
  it('includes all five backends', () => {
    expect(supportedBackends).toContain('claude');
    expect(supportedBackends).toContain('codex');
    expect(supportedBackends).toContain('gemini');
    expect(supportedBackends).toContain('opencode');
    expect(supportedBackends).toContain('kimi');
    expect(supportedBackends).toHaveLength(5);
  });
});

// ─── getAdapter ─────────────────────────────────────────────────────────────

describe('getAdapter', () => {
  it('returns a ClaudeAdapter for "claude"', () => {
    const adapter = getAdapter('claude');
    expect(adapter.name).toBe('claude');
  });

  it('returns a GeminiAdapter for "gemini"', () => {
    const adapter = getAdapter('gemini');
    expect(adapter.name).toBe('gemini');
  });

  it('returns a CodexAdapter for "codex"', () => {
    const adapter = getAdapter('codex');
    expect(adapter.name).toBe('codex');
  });

  it('returns an OpenCodeAdapter for "opencode"', () => {
    const adapter = getAdapter('opencode');
    expect(adapter.name).toBe('opencode');
  });

  it('returns a KimiAdapter for "kimi"', () => {
    const adapter = getAdapter('kimi');
    expect(adapter.name).toBe('kimi');
  });

  it('caches adapter instances (returns same reference)', () => {
    const a1 = getAdapter('claude');
    const a2 = getAdapter('claude');
    expect(a1).toBe(a2);
  });

  it('throws for unknown backend', () => {
    expect(() => getAdapter('unknown' as any)).toThrow(/Unknown CLI backend: unknown/);
  });
});
