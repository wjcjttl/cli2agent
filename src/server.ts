import Fastify from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';
import {
  validatorCompiler,
  serializerCompiler,
  jsonSchemaTransform,
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { config } from './config.js';
import { SessionManager } from './services/session-manager.js';
import { registerExecuteRoutes } from './routes/execute.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerMessageRoutes } from './routes/messages.js';
import { registerSkillRoutes } from './routes/skills.js';
import { detectAuthMethod, type AuthStatus } from './auth/detector.js';
import { HealthResponseSchema } from './schemas/index.js';
import { registerMcpRoute } from './mcp/route.js';

const app = Fastify({ logger: { level: config.logLevel } });
const sessions = new SessionManager();

// Wire Zod type provider compilers
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

// Custom error handler: formats Zod validation errors to { error, message }
app.setErrorHandler((err, request, reply) => {
  if (hasZodFastifySchemaValidationErrors(err)) {
    return reply.code(400).send({
      error: 'validation_error',
      message: err.validation.map((v: { message?: string }) => v.message).join('; '),
    });
  }
  if (isResponseSerializationError(err)) {
    request.log.error({ err }, 'Response serialization error');
    return reply.code(500).send({
      error: 'internal_error',
      message: 'Internal server error',
    });
  }
  const fastifyErr = err as { statusCode?: number; code?: string; message: string };
  const statusCode = fastifyErr.statusCode ?? 500;
  return reply.code(statusCode).send({
    error: fastifyErr.code || 'internal_error',
    message: fastifyErr.message,
  });
});

// Register Swagger plugins BEFORE auth hooks and routes
await app.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'cli2agent API',
      description: 'Expose Claude Code CLI as HTTP API endpoints for agentic task execution',
      version: '0.2.0',
    },
    tags: [
      { name: 'Health', description: 'Service health checks' },
      { name: 'Sessions', description: 'CLI session management' },
      { name: 'Execute', description: 'Prompt execution against Claude Code' },
      { name: 'Messages', description: 'Anthropic Messages API compatible endpoint' },
      { name: 'Skills', description: 'Skill and slash command management' },
    ],
    components: {
      securitySchemes: {
        apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' },
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
  },
  transform: jsonSchemaTransform,
});

await app.register(fastifySwaggerUI, {
  routePrefix: '/docs',
});

// Detect authentication method at startup
const authStatus: AuthStatus = await detectAuthMethod();
if (!authStatus.valid) {
  app.log.warn(
    `cli2agent: no authentication method detected — ${authStatus.detail}. ` +
    'Set ANTHROPIC_API_KEY, configure Bedrock/Vertex, or mount an OAuth token file.',
  );
} else {
  app.log.info(`cli2agent: auth method=${authStatus.method} — ${authStatus.detail}`);
}

// Optional API key auth
if (config.apiKey) {
  app.addHook('onRequest', async (request, reply) => {
    // Skip auth for health and docs endpoints
    if (request.url === '/health' || request.url.startsWith('/docs') || request.url.startsWith('/mcp')) return;

    const key =
      request.headers['x-api-key'] ||
      request.headers.authorization?.replace('Bearer ', '');

    if (key !== config.apiKey) {
      return reply.status(401).send({ error: 'unauthorized', message: 'Invalid API key' });
    }
  });
}

// Health check with Zod schema
app.withTypeProvider<ZodTypeProvider>().route({
  method: 'GET',
  url: '/health',
  schema: {
    tags: ['Health'],
    description: 'Service health check endpoint',
    response: { 200: HealthResponseSchema },
  },
  handler: async () => ({
    status: 'ok',
    version: '0.2.0',
    uptime: process.uptime(),
    backend: config.cliBackend,
    auth: {
      method: authStatus.method,
      detail: authStatus.detail,
    },
  }),
});

// Register route groups
registerSessionRoutes(app, sessions);
registerExecuteRoutes(app, sessions);
registerMessageRoutes(app, sessions);
registerSkillRoutes(app);
registerMcpRoute(app, sessions, authStatus);

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  app.log.info(`Received ${signal}, shutting down...`);
  await sessions.shutdown();
  await app.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info({
    host: config.host,
    port: config.port,
    logLevel: config.logLevel,
    maxConcurrent: config.maxConcurrent,
    maxSessions: config.maxSessions,
    requestTimeout: config.requestTimeout,
    workspace: config.workspace,
  }, 'cli2agent listening');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
