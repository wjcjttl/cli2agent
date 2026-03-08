import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../services/session-manager.js';
import type { AuthStatus } from '../auth/detector.js';
import { registerSessionTools } from './tools/sessions.js';
import { registerHealthTool } from './tools/health.js';
import { registerExecuteTool } from './tools/execute.js';

export function createMcpServer(sessions: SessionManager, authStatus: AuthStatus): McpServer {
  const server = new McpServer(
    { name: 'cli2agent', version: '0.1.0' },
    { capabilities: { logging: {} } },
  );

  registerSessionTools(server, sessions);
  registerHealthTool(server, authStatus);
  registerExecuteTool(server, sessions);

  return server;
}
