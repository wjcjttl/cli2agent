import { homedir } from 'os';
import { join } from 'path';

export const config = {
  logLevel: (process.env.CLI2AGENT_LOG_LEVEL || 'info') as 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal',
  port: parseInt(process.env.CLI2AGENT_PORT || '3000'),
  host: process.env.CLI2AGENT_HOST || '0.0.0.0',
  apiKey: process.env.CLI2AGENT_API_KEY || undefined,

  // Process limits
  maxConcurrent: parseInt(process.env.CLI2AGENT_MAX_CONCURRENT || '1'),
  requestTimeout: parseInt(process.env.CLI2AGENT_REQUEST_TIMEOUT || '300000'),
  queueTimeout: parseInt(process.env.CLI2AGENT_QUEUE_TIMEOUT || '30000'),

  // Session management
  maxSessions: parseInt(process.env.CLI2AGENT_MAX_SESSIONS || '100'),

  // CLI backend selection
  cliBackend: (process.env.CLI2AGENT_CLI_BACKEND || 'claude') as 'claude' | 'codex' | 'gemini' | 'opencode' | 'kimi',

  // CLI defaults
  defaultModel: process.env.CLI2AGENT_DEFAULT_MODEL || undefined,
  defaultMaxTurns: parseInt(process.env.CLI2AGENT_DEFAULT_MAX_TURNS || '25'),
  workspace: process.env.CLI2AGENT_WORKSPACE || '/workspace',

  // Claude authentication
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || undefined,
  claudeCodeUseBedrock: process.env.CLAUDE_CODE_USE_BEDROCK || undefined,
  claudeCodeUseVertex: process.env.CLAUDE_CODE_USE_VERTEX || undefined,
  anthropicBedrockBaseUrl: process.env.ANTHROPIC_BEDROCK_BASE_URL || undefined,
  anthropicVertexProjectId: process.env.ANTHROPIC_VERTEX_PROJECT_ID || undefined,
  claudeAuthTokenPath:
    process.env.CLAUDE_AUTH_TOKEN_PATH ||
    join(homedir(), '.config', 'claude', 'auth.json'),
} as const;
