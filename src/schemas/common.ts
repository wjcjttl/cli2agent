import { z } from 'zod/v4';

/** Shared error response shape used across all endpoints */
export const ErrorResponseSchema = z.object({
  error: z.string().describe('Error code identifying the error type'),
  message: z.string().describe('Human-readable error description'),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
