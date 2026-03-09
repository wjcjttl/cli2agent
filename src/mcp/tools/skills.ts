import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../../config.js';
import { listSkills } from '../../routes/skills.js';

export function registerSkillsTool(server: McpServer): void {
  server.tool(
    'skills_list',
    'List installed skills (slash commands) from user and workspace directories. Returns { backend, skills[], total }.',
    {},
    async () => {
      const skills = await listSkills();

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            backend: config.cliBackend,
            skills,
            total: skills.length,
          }),
        }],
      };
    },
  );
}
