import { z } from 'zod/v4';

/** Anthropic Messages API content block (user-side) */
const MessageContentBlockSchema = z.union([
  z.string(),
  z.array(
    z.union([
      z.object({
        type: z.literal('text'),
        text: z.string(),
      }),
      z.object({
        type: z.literal('image'),
        source: z.object({
          type: z.string(),
          media_type: z.string(),
          data: z.string(),
        }),
      }),
    ]),
  ),
]);

/** A single message in the conversation */
const MessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: MessageContentBlockSchema,
});

/** Thinking configuration */
const ThinkingSchema = z.object({
  type: z.literal('enabled'),
  budget_tokens: z.number().int().positive(),
});

/** Metadata that may include session_id */
const MetadataSchema = z.object({
  session_id: z.string().optional(),
}).passthrough().optional();

/** POST /v1/messages request body — Anthropic Messages API compatible */
export const MessagesRequestSchema = z.object({
  model: z.string().describe('Model identifier (passed through to CLI)'),
  max_tokens: z.number().int().positive().describe('Maximum tokens to generate'),
  system: z.string().optional().describe('System prompt'),
  messages: z.array(MessageSchema).min(1).describe('Conversation messages'),
  stream: z.boolean().optional().describe('Enable SSE streaming'),
  thinking: ThinkingSchema.optional().describe('Enable extended thinking'),
  temperature: z.number().min(0).max(1).optional().describe('Sampling temperature'),
  top_p: z.number().optional().describe('Top-p sampling'),
  top_k: z.number().int().optional().describe('Top-k sampling'),
  stop_sequences: z.array(z.string()).optional().describe('Stop sequences'),
  metadata: MetadataSchema,
});

export type MessagesRequest = z.infer<typeof MessagesRequestSchema>;

/** Content block in an Anthropic response */
const ResponseContentBlockSchema = z.union([
  z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('thinking'),
    thinking: z.string(),
  }),
]);

/** Non-streaming response for POST /v1/messages */
export const MessagesResponseSchema = z.object({
  id: z.string().describe('Message ID (msg_...)'),
  type: z.literal('message'),
  role: z.literal('assistant'),
  content: z.array(ResponseContentBlockSchema).describe('Response content blocks'),
  model: z.string().describe('Model used'),
  stop_reason: z.enum(['end_turn', 'max_tokens', 'stop_sequence']).nullable().describe('Stop reason'),
  stop_sequence: z.string().nullable().optional(),
  usage: z.object({
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
  }),
});

export type MessagesResponse = z.infer<typeof MessagesResponseSchema>;

/** Error response matching Anthropic API format */
export const MessagesErrorResponseSchema = z.object({
  type: z.literal('error'),
  error: z.object({
    type: z.string(),
    message: z.string(),
  }),
});

export type MessagesErrorResponse = z.infer<typeof MessagesErrorResponseSchema>;
