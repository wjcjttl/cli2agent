import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { SessionManager } from '../services/session-manager.js';
import {
  CreateSessionSchema,
  SessionResponseSchema,
  ListSessionsQuerySchema,
  SessionListResponseSchema,
  SessionParamsSchema,
  DeleteSessionQuerySchema,
  ErrorResponseSchema,
} from '../schemas/index.js';

export function registerSessionRoutes(app: FastifyInstance, sessions: SessionManager): void {
  const typedApp = app.withTypeProvider<ZodTypeProvider>();

  /** Create a new session */
  typedApp.route({
    method: 'POST',
    url: '/v1/sessions',
    schema: {
      description: 'Create a new CLI session with optional workspace, name, and model',
      tags: ['Sessions'],
      body: CreateSessionSchema,
      response: {
        201: SessionResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const body = request.body;

      try {
        const session = sessions.create({
          workspace: body.workspace,
          name: body.name,
          model: body.model,
        });
        return reply.status(201).send(session);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.status(500).send({ error: 'create_failed', message });
      }
    },
  });

  /** List sessions */
  typedApp.route({
    method: 'GET',
    url: '/v1/sessions',
    schema: {
      description: 'List sessions with optional status, workspace, limit, and offset filters',
      tags: ['Sessions'],
      querystring: ListSessionsQuerySchema,
      response: {
        200: SessionListResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { status, workspace, limit, offset } = request.query;

      const result = sessions.list({
        status,
        workspace,
        limit: limit ? parseInt(limit) : undefined,
        offset: offset ? parseInt(offset) : undefined,
      });

      return reply.send(result);
    },
  });

  /** Get session by ID */
  typedApp.route({
    method: 'GET',
    url: '/v1/sessions/:id',
    schema: {
      description: 'Get a session by ID',
      tags: ['Sessions'],
      params: SessionParamsSchema,
      response: {
        200: SessionResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const session = sessions.get(request.params.id);

      if (!session) {
        return reply.status(404).send({ error: 'not_found', message: 'Session not found' });
      }

      return reply.send(session);
    },
  });

  /** Delete a session */
  typedApp.route({
    method: 'DELETE',
    url: '/v1/sessions/:id',
    schema: {
      description: 'Delete a session. Use force=true to delete active sessions.',
      tags: ['Sessions'],
      params: SessionParamsSchema,
      querystring: DeleteSessionQuerySchema,
      response: {
        204: { type: 'null' as const, description: 'Session deleted' },
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const force = request.query.force === 'true';

      try {
        const deleted = await sessions.delete(request.params.id, force);

        if (!deleted) {
          return reply.status(404).send({ error: 'not_found', message: 'Session not found' });
        }

        return reply.status(204).send();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (message.includes('active')) {
          return reply.status(409).send({ error: 'session_active', message });
        }
        return reply.status(500).send({ error: 'delete_failed', message });
      }
    },
  });
}
