import { z } from 'zod/v4';

/** Response for GET /health */
export const HealthResponseSchema = z.object({
  status: z.string().describe('Service status'),
  version: z.string().describe('API version'),
  uptime: z.number().describe('Server uptime in seconds'),
  backend: z.string().optional().describe('CLI backend in use (claude, codex, gemini, opencode, kimi)'),
  auth: z.object({
    method: z.string().describe('Authentication method in use'),
    detail: z.string().describe('Authentication detail message'),
  }).describe('Authentication status'),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
