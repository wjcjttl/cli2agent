import type { FastifyInstance } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { SessionManager } from '../services/session-manager.js';
import type { AuthStatus } from '../auth/detector.js';
import { config } from '../config.js';
import { createMcpServer } from './server-factory.js';

export function registerMcpRoute(
  app: FastifyInstance,
  sessions: SessionManager,
  authStatus: AuthStatus,
): void {
  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    handler: async (request, reply) => {
      // Inline auth check (Fastify global hook skips /mcp)
      if (config.apiKey) {
        const key =
          (request.headers['x-api-key'] as string) ||
          (request.headers.authorization as string)?.replace('Bearer ', '');
        if (key !== config.apiKey) {
          return reply.status(401).send({ error: 'unauthorized', message: 'Invalid API key' });
        }
      }

      const server = createMcpServer(sessions, authStatus);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless mode
      });

      await server.connect(transport);

      // Tell Fastify we are handling the response ourselves
      reply.hijack();

      await transport.handleRequest(
        request.raw,
        reply.raw,
        request.body as Record<string, unknown>,
      );
    },
  });
}
