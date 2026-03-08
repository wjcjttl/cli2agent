# Anthropic Messages API Compatibility Guide

cli2agent provides a `POST /v1/messages` endpoint that accepts the standard Anthropic Messages API request format and returns Anthropic-compatible responses. This allows you to use cli2agent as a drop-in backend for tools and SDKs that target the Anthropic API, with the key difference that Claude Code's built-in tools (file editing, shell access, etc.) are available.

> **Note:** Some Messages API features are partially supported or not yet available. See the [Compatibility Matrix](#compatibility-matrix) for details.

## How It Works

When a request arrives at `/v1/messages`:

1. The latest user message is extracted and passed as the `-p` prompt to the Claude Code CLI
2. The `system` field maps to the `--system-prompt` CLI flag
3. The CLI runs its agentic loop (reading files, editing code, running commands)
4. CLI NDJSON output is translated into Anthropic-compatible SSE events (or a single JSON response)
5. Usage statistics are forwarded from the CLI on a best-effort basis

This means the "model" you interact with has full access to Claude Code's tools -- file system, shell, grep, etc. -- unlike the standard Anthropic API which only has access to tools you explicitly define.

## Compatibility Matrix

| Feature | Status | Notes |
|---------|--------|-------|
| Single-turn text messages | Supported | Full support |
| Streaming (SSE) | Supported | Anthropic-compatible event format |
| Non-streaming | Supported | Full message object returned |
| System prompts | Supported | Mapped to `--system-prompt` |
| Thinking blocks | Supported | Requires compatible model |
| Multi-turn (via sessions) | Partial | Session resumed via internal session management |
| Tool use blocks (CLI built-ins) | Partial | CLI tool invocations are visible but not controllable |
| Custom tool definitions | Not supported | The `tools` field in the request is ignored |
| Vision / image inputs | Not supported | Image content blocks are not passed to the CLI |
| Exact token counts | Best-effort | Forwarded from CLI when available; zeros otherwise |
| Model selection | Echoed | The `model` field is passed to `--model` but may not change behavior |
| `temperature` | Ignored | No CLI equivalent |
| `max_tokens` | Ignored | No CLI equivalent; the CLI manages its own limits |
| `top_p` / `top_k` | Ignored | No CLI equivalent |
| `stop_sequences` | Ignored | No CLI equivalent |

## Request Format

```
POST /v1/messages
```

The request body follows the [Anthropic Messages API specification](https://docs.anthropic.com/en/api/messages):

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 4096,
  "stream": true,
  "system": "You are a senior Python engineer. Focus on clean, testable code.",
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  },
  "messages": [
    {
      "role": "user",
      "content": "Refactor auth.py to use dependency injection"
    }
  ]
}
```

### Key Differences from Anthropic API

- `model`: Passed to the CLI via `--model`, but the actual model used depends on server configuration and CLI defaults.
- `max_tokens`: Accepted but ignored. The CLI manages output length internally.
- `tools`: Accepted but ignored. Claude Code uses its own built-in tool set.
- `messages`: Only the latest user message is used as the prompt. Prior messages provide context through session history, not through the request body.

## SSE Event Format (Streaming)

When `stream` is `true`, the response follows the Anthropic SSE protocol:

### `message_start`

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_01a2b3c4d5e6f7","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"usage":{"input_tokens":0,"output_tokens":0}}}
```

### `ping`

```
event: ping
data: {"type":"ping"}
```

### `content_block_start` (text)

```
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}
```

### `content_block_delta` (text)

```
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I'll refactor auth.py to use dependency injection."}}
```

### `content_block_start` (thinking)

```
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}
```

### `content_block_delta` (thinking)

```
event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me analyze the current structure..."}}
```

### `content_block_start` (tool_use)

```
event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01abc","name":"Read","input":{}}}
```

### `content_block_delta` (tool_use input)

```
event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"file_path\":\"auth.py\"}"}}
```

### `content_block_stop`

```
event: content_block_stop
data: {"type":"content_block_stop","index":0}
```

### `message_delta`

```
event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":342}}
```

### `message_stop`

```
event: message_stop
data: {"type":"message_stop"}
```

### Translation Rules

The translator converts CLI NDJSON events to Anthropic SSE events using these rules:

| CLI Event | Anthropic SSE Events |
|-----------|---------------------|
| First event received | `message_start` + `ping` |
| Thinking content (first occurrence) | `content_block_start` (thinking) |
| Thinking content (subsequent) | `content_block_delta` (thinking_delta) |
| Text content (first occurrence) | `content_block_start` (text) |
| Text content (subsequent) | `content_block_delta` (text_delta) |
| Tool use | Close previous block + `content_block_start` (tool_use) + `input_json_delta` |
| Tool result | Suppressed (internal to the agentic loop) |
| Stream end | `content_block_stop` + `message_delta` + `message_stop` |

Tool results from the CLI's agentic loop are **not** forwarded in Messages API mode. They are internal to the CLI's think-act-observe cycle.

## Non-Streaming Response

When `stream` is `false`, the response is a standard Anthropic message object:

```json
{
  "id": "msg_01a2b3c4d5e6f7",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-6",
  "content": [
    {
      "type": "text",
      "text": "I've refactored auth.py to use dependency injection. The key changes are..."
    }
  ],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 1523,
    "output_tokens": 342
  }
}
```

## Thinking Blocks

To enable extended thinking, include the `thinking` field in your request:

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 16000,
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  },
  "messages": [
    {"role": "user", "content": "Explain the architecture of this codebase"}
  ]
}
```

When thinking is enabled, the response includes thinking content blocks before text blocks:

```json
{
  "content": [
    {
      "type": "thinking",
      "thinking": "Let me explore the project structure first..."
    },
    {
      "type": "text",
      "text": "This codebase follows a layered architecture..."
    }
  ]
}
```

## Configuring Client Applications

### Cline (VS Code Extension)

Cline supports custom API endpoints. Configure it to point to cli2agent:

1. Open Cline settings in VS Code
2. Set **API Provider** to "Anthropic"
3. Set **Base URL** to `http://localhost:3000`
4. Set **API Key** to your `CLI2AGENT_API_KEY` value (e.g., `cli2agent-key-xxx`)
5. Select a model (e.g., `claude-sonnet-4-6`)

Cline will send requests to `POST http://localhost:3000/v1/messages` using the standard Anthropic format.

### Cursor

Cursor supports custom API endpoints for Anthropic models:

1. Open Cursor Settings > Models
2. Under Anthropic configuration, set the **API Base URL** to `http://localhost:3000`
3. Set the **API Key** to your `CLI2AGENT_API_KEY` value
4. Requests will be routed through cli2agent

### LangChain (Python)

```python
from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(
    model="claude-sonnet-4-6",
    anthropic_api_key="cli2agent-key-xxx",
    anthropic_api_url="http://localhost:3000",
)

response = llm.invoke("Explain the project structure")
print(response.content)
```

For streaming:

```python
for chunk in llm.stream("Add error handling to database.py"):
    print(chunk.content, end="", flush=True)
```

### Anthropic Python SDK

```python
import anthropic

client = anthropic.Anthropic(
    api_key="cli2agent-key-xxx",
    base_url="http://localhost:3000",
)

# Non-streaming
message = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=4096,
    messages=[
        {"role": "user", "content": "List all TODO comments in the codebase"}
    ],
)
print(message.content[0].text)

# Streaming
with client.messages.stream(
    model="claude-sonnet-4-6",
    max_tokens=4096,
    messages=[
        {"role": "user", "content": "Refactor the database module to use connection pooling"}
    ],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

With thinking enabled:

```python
message = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 10000,
    },
    messages=[
        {"role": "user", "content": "Analyze the security of this application"}
    ],
)

for block in message.content:
    if block.type == "thinking":
        print(f"[Thinking] {block.thinking}")
    elif block.type == "text":
        print(block.text)
```

### Anthropic TypeScript SDK

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: "cli2agent-key-xxx",
  baseURL: "http://localhost:3000",
});

// Non-streaming
const message = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 4096,
  messages: [
    { role: "user", content: "Explain the error handling strategy in this codebase" },
  ],
});

console.log(message.content[0].type === "text" ? message.content[0].text : "");

// Streaming
const stream = client.messages.stream({
  model: "claude-sonnet-4-6",
  max_tokens: 4096,
  messages: [
    { role: "user", content: "Add retry logic to the HTTP client" },
  ],
});

for await (const event of stream) {
  if (
    event.type === "content_block_delta" &&
    event.delta.type === "text_delta"
  ) {
    process.stdout.write(event.delta.text);
  }
}
```

## Request/Response Format Mapping

### Request Mapping

| Anthropic Field | cli2agent Handling |
|-----------------|-------------------|
| `model` | Passed to `--model` CLI flag. Echoed in response. |
| `messages` | Latest user message extracted as the CLI prompt. |
| `system` | Passed to `--system-prompt` CLI flag. |
| `stream` | `true`: SSE output. `false`: JSON output. |
| `max_tokens` | Accepted, ignored by CLI. |
| `thinking` | Passed through when the model supports it. |
| `tools` | Accepted, ignored. CLI uses built-in tools. |
| `temperature` | Accepted, ignored. |
| `top_p` | Accepted, ignored. |
| `stop_sequences` | Accepted, ignored. |
| `metadata` | Accepted, ignored. |

### Response Mapping

| Anthropic Field | cli2agent Source |
|-----------------|-----------------|
| `id` | Synthetic: `msg_` + random hex |
| `type` | Always `"message"` |
| `role` | Always `"assistant"` |
| `model` | Echoed from request |
| `content` | Translated from CLI NDJSON events |
| `stop_reason` | `"end_turn"` on success |
| `usage.input_tokens` | From CLI `result` event (best-effort) |
| `usage.output_tokens` | From CLI `result` event (best-effort) |

## Known Limitations and Workarounds

### Custom Tool Definitions Are Ignored

The `tools` array in the request is ignored. Claude Code has its own built-in tool set (Read, Edit, Bash, Grep, etc.) which cannot be extended via the Messages API.

**Workaround:** Use the `/v1/execute` endpoint with `allowed_tools` to control which built-in tools are available.

### Multi-Turn Conversations

The Messages API typically supports multi-turn by sending the full conversation in the `messages` array. cli2agent extracts only the latest user message and relies on session-level history for context.

**Workaround:** Use session management to maintain conversation context. The session is managed internally by the compatibility layer.

### Image Inputs Are Not Supported

Image content blocks in messages are not passed to the CLI.

**Workaround:** If you need Claude to analyze an image, save it to a file in the workspace and reference it by path in your prompt.

### Token Counts Are Approximate

Token usage statistics are forwarded from the CLI's result event when available. If the CLI does not report usage (e.g., on error), zeros are returned.

**Workaround:** Track token usage at the session level via `GET /v1/sessions/:id` for cumulative counts.

### Model Field Is Echoed, Not Enforced

The `model` field from the request is echoed back in the response and passed to the CLI's `--model` flag. However, the actual model used depends on server configuration and CLI defaults.

**Workaround:** Set `CLI2AGENT_DEFAULT_MODEL` on the server to enforce a specific model.

## curl Examples

### Streaming

```bash
curl -N -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: cli2agent-key-xxx" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 4096,
    "stream": true,
    "messages": [
      {"role": "user", "content": "What does the main function in server.ts do?"}
    ]
  }'
```

### Non-Streaming

```bash
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: cli2agent-key-xxx" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 4096,
    "stream": false,
    "system": "You are a code reviewer. Be concise.",
    "messages": [
      {"role": "user", "content": "Review the error handling in src/routes/execute.ts"}
    ]
  }'
```

### With Thinking

```bash
curl -N -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: cli2agent-key-xxx" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 16000,
    "stream": true,
    "thinking": {"type": "enabled", "budget_tokens": 10000},
    "messages": [
      {"role": "user", "content": "Find and fix any security vulnerabilities in the auth module"}
    ]
  }'
```
