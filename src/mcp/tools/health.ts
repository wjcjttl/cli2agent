import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthStatus } from '../../auth/detector.js';
import { config } from '../../config.js';

export function registerHealthTool(server: McpServer, authStatus: AuthStatus): void {
  server.tool(
    'get_health',
    'Get service health status including uptime and authentication method. Returns { status, version, uptime, auth }.',
    {},
    async () => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            status: 'ok',
            version: config.version,
            uptime: process.uptime(),
            auth: {
              method: authStatus.method,
              detail: authStatus.detail,
            },
          }),
        }],
      };
    },
  );
}
