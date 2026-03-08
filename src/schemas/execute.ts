import { z } from 'zod/v4';

/** Request body for POST /v1/execute */
export const ExecuteRequestSchema = z.object({
  session_id: z.string().optional().describe('Existing session to run the prompt in'),
  prompt: z.string().min(1).describe('The prompt to send to Claude Code'),
  stream: z.boolean().optional().describe('Enable Server-Sent Events streaming'),
  include_thinking: z.boolean().optional().describe('Include thinking blocks in response'),
  max_turns: z.number().int().optional().describe('Maximum agentic turns'),
  allowed_tools: z.array(z.string()).optional().describe('List of allowed tool names'),
  system_prompt: z.string().optional().describe('System prompt override'),
  model: z.string().optional().describe('Claude model to use'),
});

export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;

/** Individual content block in an execute response */
export const ExecuteContentBlockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('text'),
    text: z.string().describe('Text content'),
  }),
  z.object({
    type: z.literal('thinking'),
    text: z.string().describe('Thinking content'),
  }),
  z.object({
    type: z.literal('tool_use'),
    tool: z.string().describe('Tool name'),
    input: z.record(z.string(), z.unknown()).describe('Tool input parameters'),
  }),
  z.object({
    type: z.literal('tool_result'),
    tool: z.string().describe('Tool name'),
    output: z.string().describe('Tool output'),
  }),
]);

export type ExecuteContentBlock = z.infer<typeof ExecuteContentBlockSchema>;

/** Non-streaming response for POST /v1/execute */
export const ExecuteResponseSchema = z.object({
  task_id: z.string().describe('Unique task identifier'),
  session_id: z.string().describe('Session the task ran in'),
  status: z.enum(['completed', 'failed', 'cancelled']).describe('Final task status'),
  content: z.array(ExecuteContentBlockSchema).describe('Response content blocks'),
  usage: z.object({
    input_tokens: z.number().int().describe('Input tokens consumed'),
    output_tokens: z.number().int().describe('Output tokens consumed'),
  }).describe('Token usage statistics'),
  duration_ms: z.number().describe('Total execution time in milliseconds'),
  turns: z.number().int().describe('Number of agentic turns taken'),
});

export type ExecuteResponse = z.infer<typeof ExecuteResponseSchema>;

/** Path parameters for POST /v1/execute/:task_id/cancel */
export const CancelParamsSchema = z.object({
  task_id: z.string().describe('Task identifier to cancel'),
});

export type CancelParams = z.infer<typeof CancelParamsSchema>;
