import { z } from 'zod/v4';

/** Request body for POST /v1/sessions */
export const CreateSessionSchema = z.object({
  workspace: z.string().optional().describe('Working directory for the session'),
  name: z.string().optional().describe('Human-readable session name'),
  model: z.string().optional().describe('Claude model to use'),
});

export type CreateSession = z.infer<typeof CreateSessionSchema>;

/** Session object returned by API */
export const SessionResponseSchema = z.object({
  id: z.string().describe('Unique session identifier'),
  status: z.enum(['idle', 'active', 'errored']).describe('Current session status'),
  workspace: z.string().describe('Working directory for the session'),
  name: z.string().nullable().describe('Human-readable session name'),
  model: z.string().nullable().describe('Claude model in use'),
  message_count: z.number().int().describe('Number of messages exchanged'),
  created_at: z.string().describe('ISO 8601 creation timestamp'),
  updated_at: z.string().describe('ISO 8601 last update timestamp'),
  total_input_tokens: z.number().int().describe('Cumulative input tokens used'),
  total_output_tokens: z.number().int().describe('Cumulative output tokens used'),
});

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

/** Query parameters for GET /v1/sessions */
export const ListSessionsQuerySchema = z.object({
  status: z.string().optional().describe('Filter by session status'),
  workspace: z.string().optional().describe('Filter by workspace path'),
  limit: z.string().optional().describe('Maximum number of results'),
  offset: z.string().optional().describe('Number of results to skip'),
});

export type ListSessionsQuery = z.infer<typeof ListSessionsQuerySchema>;

/** Response for GET /v1/sessions */
export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionResponseSchema).describe('List of sessions'),
  total: z.number().int().describe('Total number of matching sessions'),
});

export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

/** Path parameters for session-specific endpoints */
export const SessionParamsSchema = z.object({
  id: z.string().describe('Session identifier'),
});

export type SessionParams = z.infer<typeof SessionParamsSchema>;

/** Query parameters for DELETE /v1/sessions/:id */
export const DeleteSessionQuerySchema = z.object({
  force: z.string().optional().describe('Force deletion even if session is active'),
});

export type DeleteSessionQuery = z.infer<typeof DeleteSessionQuerySchema>;
