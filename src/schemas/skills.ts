import { z } from 'zod/v4';

export const SkillItemSchema = z.object({
  name: z.string().describe('Skill name (derived from filename)'),
  type: z.enum(['command']).describe('Skill type'),
  scope: z.enum(['user', 'workspace']).describe('Whether the skill is user-level or workspace-level'),
  path: z.string().describe('Path to the skill file'),
});

export type SkillItem = z.infer<typeof SkillItemSchema>;

export const SkillsResponseSchema = z.object({
  backend: z.string().describe('CLI backend name'),
  skills: z.array(SkillItemSchema).describe('List of installed skills'),
  total: z.number().int().describe('Total number of skills found'),
});

export type SkillsResponse = z.infer<typeof SkillsResponseSchema>;
