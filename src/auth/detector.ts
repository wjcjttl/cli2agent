import { access, constants } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { config } from '../config.js';

export type AuthMethod = 'api_key' | 'api_key_custom_endpoint' | 'oauth_token' | 'bedrock' | 'vertex' | 'none';

export interface AuthStatus {
  method: AuthMethod;
  valid: boolean;
  detail: string;
}

export async function detectAuthMethod(): Promise<AuthStatus> {
  // 1. ANTHROPIC_API_KEY takes highest priority
  // Also support ANTHROPIC_AUTH_TOKEN as an alias
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (apiKey) {
    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    return {
      method: baseUrl ? 'api_key_custom_endpoint' : 'api_key',
      valid: true,
      detail: baseUrl
        ? `ANTHROPIC_API_KEY set, custom endpoint: ${baseUrl}`
        : 'ANTHROPIC_API_KEY set',
    };
  }

  // 2. Bedrock gateway
  if (process.env.CLAUDE_CODE_USE_BEDROCK === '1' && process.env.ANTHROPIC_BEDROCK_BASE_URL) {
    return {
      method: 'bedrock',
      valid: true,
      detail: `Bedrock gateway at ${process.env.ANTHROPIC_BEDROCK_BASE_URL}`,
    };
  }

  // 3. Vertex gateway
  if (process.env.CLAUDE_CODE_USE_VERTEX === '1' && process.env.ANTHROPIC_VERTEX_PROJECT_ID) {
    return {
      method: 'vertex',
      valid: true,
      detail: `Vertex AI project ${process.env.ANTHROPIC_VERTEX_PROJECT_ID}`,
    };
  }

  // 4. OAuth token file
  const tokenPath = config.claudeAuthTokenPath;
  try {
    await access(tokenPath, constants.R_OK);
    return {
      method: 'oauth_token',
      valid: true,
      detail: `OAuth token at ${tokenPath}`,
    };
  } catch {
    // File does not exist or is not readable — fall through
  }

  // 5. No auth found
  return {
    method: 'none',
    valid: false,
    detail: 'No authentication method detected. Set ANTHROPIC_API_KEY or mount an OAuth token file.',
  };
}
