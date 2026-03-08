import { describe, it, expect } from 'vitest';
import { extractPrompt, mergeTextBlocks } from './messages.js';

describe('extractPrompt', () => {
  it('extracts string content from user messages', () => {
    const result = extractPrompt([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'How are you?' },
    ]);
    expect(result).toBe('Hello\n\nHow are you?');
  });

  it('ignores assistant messages', () => {
    const result = extractPrompt([
      { role: 'assistant', content: 'I am an assistant' },
    ]);
    expect(result).toBe('');
  });

  it('extracts text from array content blocks', () => {
    const result = extractPrompt([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      },
    ]);
    expect(result).toBe('Part 1\n\nPart 2');
  });

  it('skips non-text blocks in array content', () => {
    const result = extractPrompt([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'A question' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ],
      },
    ]);
    expect(result).toBe('A question');
  });

  it('handles empty messages array', () => {
    expect(extractPrompt([])).toBe('');
  });

  it('handles single user message with string content', () => {
    expect(extractPrompt([{ role: 'user', content: 'Just one message' }])).toBe('Just one message');
  });

  it('skips text blocks with empty text', () => {
    const result = extractPrompt([
      {
        role: 'user',
        content: [
          { type: 'text', text: '' },
          { type: 'text', text: 'Non-empty' },
        ],
      },
    ]);
    expect(result).toBe('Non-empty');
  });

  it('handles mixed string and array content across messages', () => {
    const result = extractPrompt([
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Response' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Second' },
        ],
      },
    ]);
    expect(result).toBe('First\n\nSecond');
  });
});

describe('mergeTextBlocks', () => {
  it('returns empty array for empty input', () => {
    expect(mergeTextBlocks([])).toEqual([]);
  });

  it('returns single text block unchanged', () => {
    const result = mergeTextBlocks([{ type: 'text', text: 'Hello' }]);
    expect(result).toEqual([{ type: 'text', text: 'Hello' }]);
  });

  it('merges consecutive text blocks', () => {
    const result = mergeTextBlocks([
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world' },
    ]);
    expect(result).toEqual([{ type: 'text', text: 'Hello world' }]);
  });

  it('merges three consecutive text blocks', () => {
    const result = mergeTextBlocks([
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
      { type: 'text', text: 'C' },
    ]);
    expect(result).toEqual([{ type: 'text', text: 'ABC' }]);
  });

  it('does not merge text blocks separated by thinking', () => {
    const result = mergeTextBlocks([
      { type: 'text', text: 'Before' },
      { type: 'thinking', thinking: 'Hmm...' },
      { type: 'text', text: 'After' },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: 'text', text: 'Before' });
    expect(result[1]).toEqual({ type: 'thinking', thinking: 'Hmm...' });
    expect(result[2]).toEqual({ type: 'text', text: 'After' });
  });

  it('preserves thinking blocks', () => {
    const result = mergeTextBlocks([
      { type: 'thinking', thinking: 'Step 1' },
      { type: 'thinking', thinking: 'Step 2' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: 'thinking', thinking: 'Step 1' });
    expect(result[1]).toEqual({ type: 'thinking', thinking: 'Step 2' });
  });

  it('does not mutate original array', () => {
    const original = [
      { type: 'text' as const, text: 'A' },
      { type: 'text' as const, text: 'B' },
    ];
    mergeTextBlocks(original);
    expect(original[0].text).toBe('A');
    expect(original[1].text).toBe('B');
  });

  it('handles complex interleaved sequence', () => {
    const result = mergeTextBlocks([
      { type: 'thinking', thinking: 'Think' },
      { type: 'text', text: 'Part1' },
      { type: 'text', text: 'Part2' },
      { type: 'thinking', thinking: 'More thinking' },
      { type: 'text', text: 'Part3' },
    ]);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ type: 'thinking', thinking: 'Think' });
    expect(result[1]).toEqual({ type: 'text', text: 'Part1Part2' });
    expect(result[2]).toEqual({ type: 'thinking', thinking: 'More thinking' });
    expect(result[3]).toEqual({ type: 'text', text: 'Part3' });
  });
});
