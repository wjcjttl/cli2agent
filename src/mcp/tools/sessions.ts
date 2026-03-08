import { z } from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../services/session-manager.js';

export function registerSessionTools(server: McpServer, sessions: SessionManager): void {
  server.tool(
    'create_session',
    'Create a new CLI session for executing prompts against Claude Code. Returns session object with id, status, workspace, and timestamps.',
    {
      workspace: z.string().optional().describe('Working directory for the session (default: /workspace)'),
      name: z.string().optional().describe('Human-readable session name'),
      model: z.string().optional().describe('Claude model to use (e.g. claude-sonnet-4-20250514)'),
    },
    async (args) => {
      const session = sessions.create(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(session) }] };
    },
  );

  server.tool(
    'list_sessions',
    'List all CLI sessions with optional filters. Returns { sessions: [...], total: number }.',
    {
      status: z.string().optional().describe('Filter by status: idle, active, or errored'),
      workspace: z.string().optional().describe('Filter by workspace path'),
      limit: z.number().int().optional().describe('Max results to return (default 50)'),
      offset: z.number().int().optional().describe('Number of results to skip for pagination'),
    },
    async (args) => {
      const result = sessions.list(args);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
    },
  );

  server.tool(
    'get_session',
    'Get details of a specific CLI session by ID. Returns session object or error if not found.',
    {
      session_id: z.string().describe('Session ID to look up'),
    },
    async (args) => {
      const session = sessions.get(args.session_id);
      if (!session) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'not_found' }) }], isError: true };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(session) }] };
    },
  );

  server.tool(
    'delete_session',
    'Delete a CLI session and clean up resources. Use force=true to delete sessions that are currently active.',
    {
      session_id: z.string().describe('Session ID to delete'),
      force: z.boolean().optional().describe('Force delete even if the session is active'),
    },
    async (args) => {
      try {
        const deleted = await sessions.delete(args.session_id, args.force);
        if (!deleted) {
          return { content: [{ type: 'text' as const, text: JSON.stringify({ error: 'not_found' }) }], isError: true };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify({ success: true }) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true };
      }
    },
  );
}
