/** Common fields present on every NDJSON line from Claude Code CLI */
export interface CliEventBase {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
  type: string;
  uuid: string;
  timestamp: string;
}

/** Assistant message with model response content */
export interface CliAssistantEvent extends CliEventBase {
  type: 'assistant';
  message: {
    id: string;
    model: string;
    role: 'assistant';
    content: CliContentBlock[];
    stop_reason: string | null;
    usage: CliUsage;
  };
}

/** User input record */
export interface CliUserEvent extends CliEventBase {
  type: 'user';
  message: {
    role: 'user';
    content: CliContentBlock[];
  };
}

/** Tool result from CLI tool execution */
export interface CliToolResultEvent extends CliEventBase {
  type: 'tool_result';
  message: unknown;
  toolUseResult: unknown;
  sourceToolAssistantUUID: string;
}

/** Progress event (hooks, MCP, tool progress) */
export interface CliProgressEvent extends CliEventBase {
  type: 'progress';
  data: {
    type: string;
    status?: string;
    progressMessage?: string;
    [key: string]: unknown;
  };
  toolUseID?: string;
}

/** Final result with metadata */
export interface CliResultEvent extends CliEventBase {
  type: 'result';
  result: string;
  duration_ms: number;
  num_turns: number;
  usage: CliUsage;
}

/** Error from CLI */
export interface CliErrorEvent extends CliEventBase {
  type: 'error';
  error: {
    type: string;
    message: string;
  };
}

/** Content block types in assistant messages */
export type CliContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface CliUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export type CliEvent =
  | CliAssistantEvent
  | CliUserEvent
  | CliToolResultEvent
  | CliProgressEvent
  | CliResultEvent
  | CliErrorEvent
  | (CliEventBase & { type: string });
