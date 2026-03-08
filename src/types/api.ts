/** Request body for POST /v1/execute */
export interface ExecuteRequest {
  session_id?: string;
  prompt: string;
  stream?: boolean;
  include_thinking?: boolean;
  max_turns?: number;
  allowed_tools?: string[];
  system_prompt?: string;
  model?: string;
}

/** Non-streaming response for POST /v1/execute */
export interface ExecuteResponse {
  task_id: string;
  session_id: string;
  status: 'completed' | 'failed' | 'cancelled';
  content: ExecuteContentBlock[];
  usage: { input_tokens: number; output_tokens: number };
  duration_ms: number;
  turns: number;
}

export type ExecuteContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; tool: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool: string; output: string };

/** SSE event types for streaming execute responses */
export type ExecuteSseEvent =
  | { event: 'task_start'; data: { task_id: string; session_id: string; status: 'running' } }
  | { event: 'thinking_delta'; data: { text: string } }
  | { event: 'text_delta'; data: { text: string } }
  | { event: 'tool_use'; data: { tool: string; input: Record<string, unknown> } }
  | { event: 'tool_result'; data: { tool: string; output: string; duration_ms?: number } }
  | { event: 'task_complete'; data: { task_id: string; status: string; duration_ms: number; turns: number } }
  | { event: 'task_error'; data: { task_id: string; error: string } };

/** Request body for POST /v1/sessions */
export interface CreateSessionRequest {
  workspace?: string;
  name?: string;
  model?: string;
}

/** Session object returned by API */
export interface SessionResponse {
  id: string;
  status: 'idle' | 'active' | 'errored';
  workspace: string;
  name: string | null;
  model: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
  total_input_tokens: number;
  total_output_tokens: number;
}
