# Agentic Execution Integration Guide

The `/v1/execute` endpoint is the primary interface for running agentic tasks. You submit a prompt, and Claude Code executes an autonomous loop -- reading files, editing code, running commands -- streaming results back as Server-Sent Events (SSE) or returning a single JSON response.

## Overview

Each execution request spawns a Claude Code CLI process that:

1. Receives your prompt
2. Enters an agentic loop (think, act, observe, repeat)
3. Uses built-in tools (Read, Edit, Bash, Grep, etc.) to complete the task
4. Streams events back to your client in real time
5. Returns a final completion or error event

The CLI process is ephemeral -- it starts for each request and terminates on completion. Session state (conversation history) is persisted to JSONL files on disk, so subsequent requests to the same session resume with full context.

## Request Parameters

```
POST /v1/execute
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | -- | The task or question to send to Claude Code. Must be non-empty. |
| `session_id` | string | No | Auto-created | UUID of an existing session. If omitted, a new session is created automatically and its ID is returned in `task_start`. |
| `stream` | boolean | No | `true` | When `true`, returns an SSE event stream. When `false`, returns a single JSON response after completion. |
| `include_thinking` | boolean | No | `false` | When `true`, includes Claude's internal reasoning as `thinking_delta` events. |
| `max_turns` | integer | No | `25` | Maximum number of agentic loop iterations. Each turn is one think-act-observe cycle. Configurable server-wide via `CLI2AGENT_DEFAULT_MAX_TURNS`. |
| `allowed_tools` | string[] | No | All tools | Restrict which tools Claude can use. Example: `["Read", "Edit", "Bash"]`. |
| `system_prompt` | string | No | -- | Override the system prompt for this execution. |
| `model` | string | No | Server default | Claude model to use (e.g., `claude-sonnet-4-6`). |

## Streaming Mode (SSE)

When `stream` is `true` (the default), the response is an SSE event stream with `Content-Type: text/event-stream`.

### SSE Event Types

#### `task_start`

Emitted once at the beginning of execution. Contains the task and session identifiers.

```
event: task_start
data: {"task_id":"e47f8a21-9b3c-4d12-ae56-1f2b3c4d5e6f","session_id":"a30b1391-3602-45c0-9cd0-c17ea41577b7","status":"running"}
```

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | string | Unique identifier for this execution. |
| `session_id` | string | The session this task is running in (useful when auto-created). |
| `status` | string | Always `"running"`. |

#### `thinking_delta`

Emitted when Claude produces internal reasoning. Only appears when `include_thinking` is `true`.

```
event: thinking_delta
data: {"text":"Let me analyze the current auth.py structure to understand the dependency patterns..."}
```

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | A chunk of thinking text. Multiple events may be emitted for a single thinking block. |

#### `text_delta`

Emitted when Claude produces visible response text.

```
event: text_delta
data: {"text":"I'll refactor auth.py to use dependency injection. Here's my plan:\n\n1. "}
```

| Field | Type | Description |
|-------|------|-------------|
| `text` | string | A chunk of response text. |

#### `tool_use`

Emitted when Claude invokes a built-in tool (Read, Edit, Bash, Grep, Glob, etc.).

```
event: tool_use
data: {"tool":"Read","input":{"file_path":"src/auth.py"}}
```

| Field | Type | Description |
|-------|------|-------------|
| `tool` | string | Name of the tool being invoked. |
| `input` | object | Tool-specific input parameters. |

Common tools and their inputs:

| Tool | Example Input |
|------|---------------|
| `Read` | `{"file_path": "src/auth.py"}` |
| `Edit` | `{"file_path": "src/auth.py", "old_string": "...", "new_string": "..."}` |
| `Write` | `{"file_path": "src/new_file.py", "content": "..."}` |
| `Bash` | `{"command": "python -m pytest tests/"}` |
| `Grep` | `{"pattern": "class Auth", "path": "src/"}` |
| `Glob` | `{"pattern": "**/*.py", "path": "src/"}` |

#### `tool_result`

Emitted after a tool finishes executing with its output.

```
event: tool_result
data: {"tool":"Read","output":"import hashlib\nfrom typing import Optional\n\nclass AuthService:\n    def __init__(self):\n        self.secret = 'hardcoded'\n"}
```

| Field | Type | Description |
|-------|------|-------------|
| `tool` | string | Name of the tool that produced the result. |
| `output` | string | The tool's output (file contents, command stdout, etc.). |
| `duration_ms` | number | (Optional) Time the tool took to execute. |

#### `task_complete`

Emitted once when the task finishes successfully.

```
event: task_complete
data: {"task_id":"e47f8a21-9b3c-4d12-ae56-1f2b3c4d5e6f","status":"completed","duration_ms":18450,"turns":4}
```

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | string | The task identifier from `task_start`. |
| `status` | string | `"completed"`. |
| `duration_ms` | number | Total execution time in milliseconds. |
| `turns` | number | Number of agentic loop iterations. |

#### `task_error`

Emitted when execution fails (CLI crash, timeout, invalid configuration, etc.).

```
event: task_error
data: {"task_id":"e47f8a21-9b3c-4d12-ae56-1f2b3c4d5e6f","error":"CLI exited with code 1"}
```

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | string | The task identifier. |
| `error` | string | Human-readable error description. |

### Full Streaming Example

A typical stream looks like this:

```
event: task_start
data: {"task_id":"e47f8a21-...","session_id":"a30b1391-...","status":"running"}

event: thinking_delta
data: {"text":"The user wants me to add input validation to the login endpoint. Let me first read the current code."}

event: tool_use
data: {"tool":"Read","input":{"file_path":"src/routes/login.py"}}

event: tool_result
data: {"tool":"Read","output":"from flask import request\n\n@app.route('/login', methods=['POST'])\ndef login():\n    username = request.json['username']\n    ..."}

event: text_delta
data: {"text":"I can see the login endpoint doesn't validate inputs. I'll add validation using pydantic."}

event: tool_use
data: {"tool":"Edit","input":{"file_path":"src/routes/login.py","old_string":"from flask import request","new_string":"from flask import request\nfrom pydantic import BaseModel, validator\n\nclass LoginRequest(BaseModel):\n    username: str\n    password: str"}}

event: tool_result
data: {"tool":"Edit","output":"File edited successfully."}

event: text_delta
data: {"text":"I've added a Pydantic model for input validation. The login endpoint now validates the request body before processing."}

event: task_complete
data: {"task_id":"e47f8a21-...","status":"completed","duration_ms":12340,"turns":3}
```

## Non-Streaming Mode

When `stream` is `false`, the server collects all events and returns a single JSON response after the task completes.

### Response Structure

```json
{
  "task_id": "e47f8a21-9b3c-4d12-ae56-1f2b3c4d5e6f",
  "session_id": "a30b1391-3602-45c0-9cd0-c17ea41577b7",
  "status": "completed",
  "content": [
    {
      "type": "thinking",
      "text": "Let me analyze the current auth.py structure..."
    },
    {
      "type": "text",
      "text": "I've refactored auth.py to use dependency injection."
    },
    {
      "type": "tool_use",
      "tool": "Edit",
      "input": {"file_path": "src/auth.py", "old_string": "...", "new_string": "..."}
    },
    {
      "type": "tool_result",
      "tool": "Edit",
      "output": "File edited successfully."
    },
    {
      "type": "text",
      "text": "The refactoring is complete. All dependencies are now injected via the constructor."
    }
  ],
  "usage": {
    "input_tokens": 4523,
    "output_tokens": 1234
  },
  "duration_ms": 12340,
  "turns": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `task_id` | string | Unique task identifier. |
| `session_id` | string | Session the task ran in. |
| `status` | string | `"completed"`, `"failed"`, or `"cancelled"`. |
| `content` | array | Ordered list of content blocks (text, thinking, tool_use, tool_result). |
| `usage` | object | Token usage: `input_tokens` and `output_tokens`. Best-effort counts. |
| `duration_ms` | number | Total execution time in milliseconds. |
| `turns` | number | Number of agentic loop iterations. |

## Auto-Session Creation

If you omit `session_id`, a new session is created automatically. The session ID is returned in the `task_start` event (streaming) or the top-level `session_id` field (non-streaming). Save this ID if you want to continue the conversation:

```bash
# No session_id -- a new session is created
curl -X POST http://localhost:3000/v1/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: cli2agent-key-xxx" \
  -d '{"prompt": "List all Python files in the project"}'
```

The `task_start` event will contain the newly created `session_id`:

```
event: task_start
data: {"task_id":"...","session_id":"newly-created-uuid","status":"running"}
```

## Client Disconnect Behavior

If the client disconnects during a streaming response (closes the HTTP connection), cli2agent:

1. Sends `SIGTERM` to the running CLI process
2. The CLI process is given a brief window to shut down gracefully
3. The session transitions back to **idle** state

This prevents orphaned processes from consuming resources.

## Tool Filtering with `allowed_tools`

Use the `allowed_tools` parameter to restrict which tools Claude can use. This is useful for read-only analysis, safe exploration, or limiting scope:

```json
{
  "prompt": "Analyze the codebase architecture",
  "allowed_tools": ["Read", "Grep", "Glob"],
  "session_id": "a30b1391-..."
}
```

Common tool subsets:

| Use Case | Allowed Tools |
|----------|---------------|
| Read-only analysis | `["Read", "Grep", "Glob"]` |
| Code editing only | `["Read", "Edit", "Write", "Grep", "Glob"]` |
| Full access | Omit the field (all tools enabled) |
| Git operations | `["Read", "Bash(git:*)"]` |

## Error Handling

| Status | Error Code | Cause |
|--------|------------|-------|
| `400` | (validation) | Missing `prompt`, invalid types, etc. |
| `409` | `session_busy` | The session is already processing another request. |
| `429` | `queue_timeout` | All process slots are busy and the request timed out waiting. Adjust `CLI2AGENT_MAX_CONCURRENT` or `CLI2AGENT_QUEUE_TIMEOUT`. |
| `500` | `execution_failed` | CLI process failed to start or crashed. |

### 409 Session Busy

```json
{
  "error": "session_busy",
  "message": "Session is currently processing another request"
}
```

Wait for the current task to complete before submitting another prompt to the same session, or use a different session.

### 500 Execution Failed

```json
{
  "error": "execution_failed",
  "message": "CLI failed: Error: Invalid API key"
}
```

Check the server logs and ensure `ANTHROPIC_API_KEY` (or other auth) is correctly configured.

## Examples

### curl -- Streaming

```bash
curl -N -X POST http://localhost:3000/v1/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: cli2agent-key-xxx" \
  -d '{
    "session_id": "a30b1391-3602-45c0-9cd0-c17ea41577b7",
    "prompt": "Add input validation to the login endpoint in src/routes/login.py",
    "stream": true,
    "include_thinking": true,
    "max_turns": 10,
    "allowed_tools": ["Read", "Edit", "Grep"]
  }'
```

The `-N` flag disables output buffering in curl so you see events as they arrive.

### curl -- Non-Streaming

```bash
curl -X POST http://localhost:3000/v1/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: cli2agent-key-xxx" \
  -d '{
    "prompt": "Explain the architecture of this project",
    "stream": false,
    "max_turns": 5
  }'
```

### Python SSE Client

```python
import json
import requests

BASE_URL = "http://localhost:3000"
HEADERS = {
    "Content-Type": "application/json",
    "x-api-key": "cli2agent-key-xxx",
}


def execute_streaming(prompt: str, session_id: str | None = None):
    """Execute a prompt and process SSE events as they arrive."""
    payload = {
        "prompt": prompt,
        "stream": True,
        "include_thinking": True,
    }
    if session_id:
        payload["session_id"] = session_id

    resp = requests.post(
        f"{BASE_URL}/v1/execute",
        headers=HEADERS,
        json=payload,
        stream=True,
    )
    resp.raise_for_status()

    current_event = None
    for line in resp.iter_lines(decode_unicode=True):
        if not line:
            continue
        if line.startswith("event: "):
            current_event = line[7:]
        elif line.startswith("data: "):
            data = json.loads(line[6:])
            handle_event(current_event, data)


def handle_event(event_type: str, data: dict):
    match event_type:
        case "task_start":
            print(f"Task started: {data['task_id']} (session: {data['session_id']})")
        case "thinking_delta":
            print(f"  [thinking] {data['text']}")
        case "text_delta":
            print(data["text"], end="", flush=True)
        case "tool_use":
            print(f"\n  -> Using tool: {data['tool']}({data['input']})")
        case "tool_result":
            output = data["output"][:200] + "..." if len(data["output"]) > 200 else data["output"]
            print(f"  <- Result: {output}")
        case "task_complete":
            print(f"\nCompleted in {data['duration_ms']}ms ({data['turns']} turns)")
        case "task_error":
            print(f"\nError: {data['error']}")


# Usage
execute_streaming(
    prompt="Add type hints to all functions in src/utils.py",
    session_id="a30b1391-3602-45c0-9cd0-c17ea41577b7",
)
```

For a more robust implementation, use the `sseclient-py` library:

```python
import sseclient
import requests

resp = requests.post(
    f"{BASE_URL}/v1/execute",
    headers=HEADERS,
    json={"prompt": "Explain this codebase", "stream": True},
    stream=True,
)
resp.raise_for_status()

client = sseclient.SSEClient(resp)
for event in client.events():
    data = json.loads(event.data)
    print(f"[{event.event}] {data}")
```

### Node.js / TypeScript

```typescript
const BASE_URL = "http://localhost:3000";

interface ExecuteOptions {
  prompt: string;
  sessionId?: string;
  includeThinking?: boolean;
  maxTurns?: number;
  allowedTools?: string[];
}

async function executeStreaming(options: ExecuteOptions): Promise<string | null> {
  const resp = await fetch(`${BASE_URL}/v1/execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "cli2agent-key-xxx",
    },
    body: JSON.stringify({
      prompt: options.prompt,
      session_id: options.sessionId,
      stream: true,
      include_thinking: options.includeThinking ?? false,
      max_turns: options.maxTurns ?? 25,
      allowed_tools: options.allowedTools,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(`Execute failed (${resp.status}): ${err.message}`);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sessionId: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    let currentEvent = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7);
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        switch (currentEvent) {
          case "task_start":
            sessionId = data.session_id;
            console.log(`Task ${data.task_id} started`);
            break;
          case "thinking_delta":
            process.stdout.write(`[think] ${data.text}`);
            break;
          case "text_delta":
            process.stdout.write(data.text);
            break;
          case "tool_use":
            console.log(`\n-> ${data.tool}(${JSON.stringify(data.input)})`);
            break;
          case "tool_result":
            console.log(`<- ${data.output.slice(0, 200)}`);
            break;
          case "task_complete":
            console.log(`\nDone in ${data.duration_ms}ms (${data.turns} turns)`);
            break;
          case "task_error":
            console.error(`\nError: ${data.error}`);
            break;
        }
      }
    }
  }

  return sessionId;
}

// Usage
const sessionId = await executeStreaming({
  prompt: "Add error handling to the database connection module",
  includeThinking: true,
  maxTurns: 10,
  allowedTools: ["Read", "Edit", "Grep"],
});

// Continue in the same session
if (sessionId) {
  await executeStreaming({
    prompt: "Now add unit tests for the changes you just made",
    sessionId,
  });
}
```

### Non-Streaming with Python

```python
def execute_sync(prompt: str, session_id: str | None = None) -> dict:
    """Execute a prompt and return the full result."""
    payload = {
        "prompt": prompt,
        "stream": False,
        "max_turns": 10,
    }
    if session_id:
        payload["session_id"] = session_id

    resp = requests.post(
        f"{BASE_URL}/v1/execute",
        headers=HEADERS,
        json=payload,
    )
    resp.raise_for_status()
    result = resp.json()

    print(f"Status: {result['status']}")
    print(f"Turns: {result['turns']}, Duration: {result['duration_ms']}ms")
    print(f"Tokens: {result['usage']['input_tokens']} in / {result['usage']['output_tokens']} out")

    for block in result["content"]:
        if block["type"] == "text":
            print(block["text"])

    return result
```
