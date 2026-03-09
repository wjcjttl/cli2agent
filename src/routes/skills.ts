import { readdir } from 'fs/promises';
import { join } from 'path';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { config } from '../config.js';
import { SkillsResponseSchema, type SkillItem } from '../schemas/skills.js';

async function scanCommandsDir(dir: string, scope: 'user' | 'workspace'): Promise<SkillItem[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => ({
        name: entry.name.replace(/\.md$/, ''),
        type: 'command' as const,
        scope,
        path: join(dir, entry.name),
      }));
  } catch {
    // Directory may not exist — return empty array
    return [];
  }
}

export async function listSkills(): Promise<SkillItem[]> {
  const home = process.env.HOME || '/home/node';
  const userCommandsDir = join(home, '.claude', 'commands');
  const workspaceCommandsDir = join(config.workspace, '.claude', 'commands');

  const [userSkills, workspaceSkills] = await Promise.all([
    scanCommandsDir(userCommandsDir, 'user'),
    scanCommandsDir(workspaceCommandsDir, 'workspace'),
  ]);

  return [...userSkills, ...workspaceSkills];
}

export function registerSkillRoutes(app: FastifyInstance): void {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  typedApp.route({
    method: 'GET',
    url: '/v1/skills',
    schema: {
      description: 'List installed skills (slash commands) from user and workspace directories',
      tags: ['Skills'],
      response: {
        200: SkillsResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const skills = await listSkills();

      return reply.send({
        backend: config.cliBackend,
        skills,
        total: skills.length,
      });
    },
  });
}
