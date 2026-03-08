# cli2agent Architecture Design

> Synthesized from parallel research agents exploring Docker containerization, service skeleton, session management, task invocation, passthrough streaming, and CLI protocol parsing.

## 1. System Overview

cli2agent is a containerized HTTP service that wraps the Claude Code CLI, exposing it via REST + SSE endpoints. It enables programmatic, agentic task execution — sending prompts to Claude Code and streaming back results including thinking, text, and tool executions.

```
┌─────────────────────────────────────────────────────┐
│  Client (Cline / Cursor / SDK / Orchestrator)       │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP (REST + SSE)
                       ▼
┌─────────────────────────────────────────────────────┐
│  cli2agent Service (Node.js / TypeScript)           │
│  ┌───────────┐ ┌────────────┐ ┌──────────────────┐ │
│  │ API Routes │ │ Session    │ │ Stream Translator│ │
│  │            │ │ Manager    │ │ (NDJSON → SSE)   │ │
│  └─────┬─────┘ └─────┬──────┘ └────────┬─────────┘ │
│        │              │                 │           │
│  ┌─────▼──────────────▼─────────────────▼─────────┐ │
│  │         CLI Process Manager                     │ │
│  │  spawn claude -p --output-format stream-json    │ │
│  └─────────────────────┬───────────────────────────┘ │
└────────────────────────┼────────────────────────────┘
                         │ stdin/stdout (NDJSON)
                         ▼
┌─────────────────────────────────────────────────────┐
│  Claude Code CLI (@anthropic-ai/claude-code)        │
│  - Context management    - Tool execution           │
│  - Session persistence   - MCP integration          │
└─────────────────────────────────────────────────────┘
```

## 2. Technology Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Language | TypeScript (Node.js 20) | Aligns with Claude Code CLI runtime; strong streaming/async support |
| HTTP Framework | Fastify | Best SSE/streaming perf, schema validation, low overhead |
| Process Management | Node.js `child_process` | Native subprocess spawning with stdin/stdout streams |
| Session Store | SQLite (via `better-sqlite3`) | Lightweight, no external deps, embedded in container |
| Container | Docker (`node:20-slim`) | Debian-based for glibc compat with Claude Code's npm package |
| Auth | `ANTHROPIC_API_KEY` env var | Simplest for containers; no OAuth refresh needed |

### Alternative: SDK Mode

The `@anthropic-ai/claude-code` package exports a TypeScript SDK that avoids subprocess spawning:

```typescript
import { query } from "@anthropic-ai/claude-code";

const result = await query({
  prompt: "Explain this codebase",
  options: {
    model: "claude-sonnet-4-6",
    maxTurns: 10,
    allowedTools: ["Read", "Bash(git:*)"],
  },
});
```

**Recommendation:** Support both modes. SDK mode for lower latency; subprocess mode for full CLI flag control. Start with subprocess (better documented), add SDK later.

## 3. Project Structure

```
cli2agent/
├── src/
│   ├── server.ts                 # Fastify server setup, plugin registration
│   ├── config.ts                 # Environment-based configuration
│   ├── routes/
│   │   ├── sessions.ts           # POST/GET/DELETE /v1/sessions
│   │   ├── execute.ts            # POST /v1/execute (agentic task API)
│   │   └── messages.ts           # POST /v1/messages (Anthropic compat)
│   ├── services/
│   │   ├── session-manager.ts    # Session lifecycle, locking, cleanup
│   │   ├── cli-process.ts        # Claude CLI subprocess spawning & management
│   │   └── process-pool.ts       # Concurrency limits, queueing
│   ├── stream/
│   │   ├── ndjson-parser.ts      # Line-by-line NDJSON parser from stdout
│   │   ├── sse-writer.ts         # Format events as SSE for HTTP responses
│   │   └── translator.ts         # CLI events → Anthropic API events (state machine)
│   └── types/
│       ├── cli-events.ts         # TypeScript types for CLI NDJSON events
│       ├── api.ts                # Request/response schemas
│       └── anthropic.ts          # Anthropic Messages API types
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
└── docs/
    └── architecture.md           # This file
```

## 4. Docker Containerization

### 4.1 Dockerfile

```dockerfile
FROM node:20-slim

# System dependencies for Claude Code
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code@latest

# Disable auto-updater in containers
ENV DISABLE_AUTOUPDATER=1

# Create workspace and .claude directories
RUN mkdir -p /workspace && chown node:node /workspace
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node/.claude

# Install service
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY dist/ ./dist/
RUN chown -R node:node /app

USER node
EXPOSE 3000

ENTRYPOINT ["node", "dist/server.js"]
```

### 4.2 Volume Mount Architecture

```yaml
# docker-compose.yml
version: "3.8"

services:
  cli2agent:
    build: .
    ports:
      - "3000:3000"
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - DISABLE_AUTOUPDATER=1
      - HOME=/home/node
    volumes:
      # Target code repository
      - ${WORKSPACE_PATH:-./workspace}:/workspace:rw
      # Claude home directory (sessions, settings, history)
      - claude-data:/home/node/.claude
    working_dir: /workspace
    user: "1000:1000"
    deploy:
      resources:
        limits:
          cpus: "4.0"
          memory: 4G
        reservations:
          cpus: "1.0"
          memory: 1G
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    security_opt:
      - no-new-privileges:true

volumes:
  claude-data:
    driver: local
```

### 4.3 Key File Paths Inside Container

| Path | Purpose |
|------|---------|
| `/workspace` | Mounted code repository (Claude Code's working directory) |
| `/workspace/CLAUDE.md` | Project-level system prompt (read automatically by CLI) |
| `/workspace/.mcp.json` | MCP server configuration |
| `/workspace/.claude/settings.json` | Project-level settings |
| `/home/node/.claude/` | User-scope config, sessions, history |
| `/home/node/.claude/projects/-workspace/` | Session JSONL files for `/workspace` |
| `/home/node/.claude/settings.json` | User-scope settings |
| `/home/node/.claude/CLAUDE.md` | Global user instructions |
| `/home/node/.config/claude/auth.json` | OAuth credentials (if not using API key) |

### 4.4 Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes* | API key authentication (*or use OAuth/Bedrock) |
| `DISABLE_AUTOUPDATER` | Recommended | Prevent CLI auto-updates in containers |
| `CLI2AGENT_PORT` | No | Service port (default: 3000) |
| `CLI2AGENT_MAX_CONCURRENT` | No | Max concurrent CLI processes (default: 5) |
| `CLI2AGENT_REQUEST_TIMEOUT` | No | Request timeout in ms (default: 300000) |
| `CLI2AGENT_API_KEY` | No | Proxy-level auth key for clients |

## 5. API Design

### 5.1 API Group 1: Session Management (REST)

#### `POST /v1/sessions` — Create a new session

```json
// Request
{
  "workspace": "/workspace",
  "name": "Feature X development",
  "model": "claude-sonnet-4-6"
}

// Response 201
{
  "id": "a30b1391-3602-45c0-9cd0-c17ea41577b7",
  "status": "idle",
  "workspace": "/workspace",
  "name": "Feature X development",
  "created_at": "2026-03-06T02:45:44.834Z",
  "message_count": 0
}
```

No CLI process is spawned — just reserves a UUID.

#### `GET /v1/sessions` — List sessions

Query params: `status`, `workspace`, `limit`, `offset`

#### `GET /v1/sessions/:id` — Get session details

Includes process info (pid, alive), token usage totals, message count.

#### `DELETE /v1/sessions/:id` — Delete session

Terminates any active CLI process, removes JSONL file and artifacts.
Use `?force=true` to force-kill an active session.

#### `POST /v1/sessions/:id/fork` — Fork from existing session

```json
// Request
{
  "name": "Experiment: alternative approach",
  "after_message_id": "uuid-of-message"
}

// Response 201
{
  "id": "new-session-uuid",
  "forked_from": "a30b1391-...",
  "status": "idle"
}
```

### 5.2 API Group 2: Task Execution (SSE)

The primary endpoint for agentic work.

#### `POST /v1/execute`

```json
// Request
{
  "session_id": "uuid",
  "prompt": "Refactor auth.py to use dependency injection",
  "stream": true,
  "include_thinking": true,
  "max_turns": 10,
  "allowed_tools": ["Edit", "Read", "Bash"],
  "system_prompt": "You are a senior Python engineer",
  "model": "claude-sonnet-4-6"
}
```

**Streaming response (SSE):**
```
event: task_start
data: {"task_id":"uuid","session_id":"uuid","status":"running"}

event: thinking_delta
data: {"text":"Let me analyze the current auth.py structure..."}

event: text_delta
data: {"text":"I'll refactor auth.py to use dependency injection. "}

event: tool_use
data: {"tool":"Read","input":{"file_path":"auth.py"}}

event: tool_result
data: {"tool":"Read","output":"class AuthService:...","duration_ms":45}

event: text_delta
data: {"text":"Now I'll modify the class to accept dependencies..."}

event: tool_use
data: {"tool":"Edit","input":{"file_path":"auth.py","changes":"..."}}

event: task_complete
data: {"task_id":"uuid","status":"completed","duration_ms":12340,"turns":3}
```

**Non-streaming response:**
```json
{
  "task_id": "uuid",
  "session_id": "uuid",
  "status": "completed",
  "content": [
    {"type": "thinking", "text": "..."},
    {"type": "text", "text": "I refactored auth.py..."},
    {"type": "tool_use", "tool": "Edit", "input": {...}}
  ],
  "usage": {"input_tokens": 4523, "output_tokens": 1234},
  "duration_ms": 12340,
  "turns": 3
}
```

**CLI invocation mapping:**
```bash
claude -p \
  --session-id <session_id> \
  --output-format stream-json \
  --include-partial-messages \
  --dangerously-skip-permissions \
  --model <model> \
  --max-turns <max_turns> \
  --allowedTools "<allowed_tools>" \
  --system-prompt "<system_prompt>" \
  "<prompt>"
```

#### `POST /v1/execute/:task_id/cancel` — Cancel running task

Sends SIGTERM to the CLI process. Returns `202 Accepted`.

### 5.3 API Group 3: Anthropic Messages API Compatibility (REST/SSE)

Drop-in replacement for `POST /v1/messages` — allows Cline, Cursor, LangChain, and Anthropic SDKs to use cli2agent as a backend.

#### `POST /v1/messages`

Accepts the standard Anthropic Messages API format. The translation layer handles conversion.

**Request translation:**

| API Parameter | CLI Mapping |
|---------------|-------------|
| `messages` | Extract latest user message as `-p` prompt |
| `system` | `--system-prompt` flag |
| `model` | `--model` flag (echoed back in response) |
| `stream: true` | `--output-format stream-json` |
| `stream: false` | `--output-format json` |
| `max_tokens` | No CLI equivalent (ignored) |
| `temperature` | No CLI equivalent (ignored) |
| `tools` | Ignored (CLI has built-in tools) |
| `thinking` | Supported if model supports it |

**SSE event stream (Anthropic-compatible format):**

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_01...","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"usage":{"input_tokens":0,"output_tokens":0}}}

event: ping
data: {"type":"ping"}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":15}}

event: message_stop
data: {"type":"message_stop"}
```

**Compatibility scope:**

| Feature | Status |
|---------|--------|
| Single-turn text messages | Fully supported |
| Streaming (SSE) | Fully supported |
| Non-streaming | Fully supported |
| System prompts | Fully supported |
| Thinking blocks | Supported |
| Tool use blocks (CLI built-in) | Partially supported |
| Multi-turn (via sessions) | Partially supported |
| Custom tool definitions | Not supported |
| Vision/image inputs | Not supported |
| Exact token counts | Best-effort |
| Model selection | Echoed but may not change behavior |

## 6. CLI NDJSON Protocol

### 6.1 CLI Invocation for Streaming

```bash
claude -p \
  --output-format stream-json \
  --include-partial-messages \
  --dangerously-skip-permissions \
  --session-id <uuid> \
  "prompt"
```

### 6.2 NDJSON Event Types

Each line of stdout is a JSON object. Key types documented from CLI output analysis:

| Type | Description | Key Fields |
|------|-------------|------------|
| `assistant` | Start/update of assistant turn | `message.model`, `message.content[]`, `message.usage` |
| `user` | User input record | `message.content` |
| `progress` | Hook/tool execution progress | `data.type`, `data.progressMessage` |
| `tool_result` | Result from tool execution | `message`, `toolUseResult`, `sourceToolAssistantUUID` |
| `file-history-snapshot` | File state snapshot for undo | File paths and content |
| `result` | Final result with metadata | Usage stats, stop reason |
| `error` | Error event | Error message and type |

### 6.3 Message Structure

Every NDJSON line shares common fields:

```json
{
  "parentUuid": "<uuid> | null",
  "isSidechain": false,
  "userType": "external",
  "cwd": "/workspace",
  "sessionId": "<session-uuid>",
  "version": "2.1.70",
  "gitBranch": "HEAD",
  "type": "<event-type>",
  "uuid": "<message-uuid>",
  "timestamp": "2026-03-06T02:45:44.834Z"
}
```

Messages form a **linked list via `parentUuid`**, enabling conversation reconstruction and fork detection.

### 6.4 Bidirectional Protocol (Advanced)

Using `--input-format stream-json`, the CLI accepts structured input on stdin:

- `control_response` — grant/deny permission for tool use
- Format: `{"type": "control_response", "subtype": "can_use_tool", "allow": true}`

This enables interactive permission prompts via the API (future WebSocket upgrade path).

## 7. Stream Translation State Machine

The translator converts CLI NDJSON events to either the native cli2agent SSE format (for `/v1/execute`) or the Anthropic-compatible SSE format (for `/v1/messages`).

### 7.1 Translator State

```typescript
interface TranslatorState {
  messageId: string;                // Synthetic msg_XXXX ID
  currentBlockIndex: number;        // Increments per content block
  currentBlockType: 'text' | 'thinking' | 'tool_use' | null;
  messageStartSent: boolean;
  inputTokens: number;
  outputTokens: number;
}
```

### 7.2 Translation Rules (for `/v1/messages` compat)

| CLI Event | Anthropic SSE Events |
|-----------|---------------------|
| First event | `message_start` + `ping` (synthetic) |
| `thinking` (first) | `content_block_start` (thinking, index N) |
| `thinking_delta` | `content_block_delta` (thinking_delta, index N) |
| Text (first) | `content_block_start` (text, index N) |
| `text_delta` | `content_block_delta` (text_delta, index N) |
| `tool_use` | Close prev block + `content_block_start` (tool_use) + `input_json_delta` |
| `tool_result` | Suppressed (internal to agentic loop) |
| Stream end | `content_block_stop` + `message_delta` + `message_stop` |

### 7.3 Key Design Decisions

1. **Tool results are suppressed** in Anthropic compat mode — they're internal to the CLI's agentic loop
2. **Usage stats are best-effort** — forwarded from CLI `result` event if available, otherwise zeros
3. **Model is echoed** from request, not derived from CLI
4. **Message ID is synthetic** — `msg_` + random hex

## 8. Session Management Internals

### 8.1 Session Storage

Claude Code stores sessions as JSONL files:

```
~/.claude/projects/<encoded-path>/<session-uuid>.jsonl
```

Where `<encoded-path>` = workspace absolute path with `/` replaced by `-`.
Example: `/workspace` → `-workspace`

The proxy maintains its own SQLite registry for fast metadata queries:

```sql
CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,
    workspace       TEXT NOT NULL,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'idle',  -- idle|active|errored
    model           TEXT,
    message_count   INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    pid             INTEGER,
    total_input_tokens  INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    forked_from     TEXT
);
```

### 8.2 Session Lifecycle

```
POST /sessions → IDLE
                   │
    POST /execute  │  POST /messages
                   ▼
                ACTIVE (CLI process running)
                   │
         ┌─────────┼──────────┐
         ▼         ▼          ▼
       IDLE     ERRORED    (client disconnect
    (complete)  (crash)     → kill process → IDLE)
         │
   DELETE /sessions/:id
         ▼
       DELETED
```

### 8.3 Concurrency

- **One prompt at a time per session** — CLI maintains in-process state
- **Queue with reject**: concurrent requests to same session get queued (max depth: 5, timeout: 30s)
- **Per-session mutex** for process-level locking
- Returns `409 Conflict` if session is busy and queue is full

### 8.4 Process Model

**Phase 1: Ephemeral (per-request)**
- Spawn new `claude -p` process for each message
- Use `--session-id` to resume from JSONL on disk
- Simpler crash recovery, no long-lived process management

**Phase 2: Long-lived (optimization)**
- Keep CLI process alive using `--input-format stream-json`
- Feed prompts via stdin, read responses from stdout
- Lower latency but more complex

## 9. NDJSON Parser

### 9.1 Implementation

```typescript
import { createInterface } from 'readline';

function parseCliStream(
  stdout: NodeJS.ReadableStream,
  onEvent: (event: CliEvent) => void,
  onError: (err: Error) => void,
  onEnd: () => void
): void {
  const rl = createInterface({ input: stdout });

  rl.on('line', (line: string) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line) as CliEvent;
      onEvent(event);
    } catch (err) {
      onError(new Error(`Failed to parse NDJSON line: ${line}`));
    }
  });

  rl.on('close', onEnd);
  rl.on('error', onError);
}
```

### 9.2 Backpressure

When writing SSE to the HTTP response:

```typescript
const canContinue = response.raw.write(ssePayload);
if (!canContinue) {
  await new Promise(resolve => response.raw.once('drain', resolve));
}
```

### 9.3 Client Disconnect Cleanup

```typescript
request.raw.on('close', () => {
  cliProcess.kill('SIGTERM');
  // Allow 5s for graceful shutdown, then SIGKILL
  setTimeout(() => {
    if (!cliProcess.killed) cliProcess.kill('SIGKILL');
  }, 5000);
});
```

## 10. Security

### 10.1 Container Security

- Run as non-root user `node` (uid 1000)
- `security_opt: no-new-privileges`
- `DISABLE_AUTOUPDATER=1` for reproducible builds
- Resource limits: 4GB memory, 4 CPUs (supports ~6 concurrent sessions)

### 10.2 API Authentication

- `CLI2AGENT_API_KEY` env var sets the proxy-level auth key
- Clients pass via `x-api-key` header or `Authorization: Bearer`
- This is separate from `ANTHROPIC_API_KEY` (which authenticates CLI → Anthropic)

### 10.3 CLI Permissions

- `--dangerously-skip-permissions` required for headless mode
- Use `--allowedTools` to restrict tool access per request
- Configure `permissions.deny` in settings.json for sensitive files:
  ```json
  {"permissions": {"deny": ["Read(./.env)", "Read(./secrets/**)"]}}
  ```

### 10.4 Secrets Management

- Never bake `ANTHROPIC_API_KEY` into Docker image
- Pass via env vars at runtime or Docker secrets
- Set `CLAUDE_CODE_ENABLE_TELEMETRY=0` if telemetry is a concern

## 11. Configuration

```typescript
// src/config.ts
export const config = {
  port: parseInt(process.env.CLI2AGENT_PORT || '3000'),
  apiKey: process.env.CLI2AGENT_API_KEY,        // proxy auth
  anthropicKey: process.env.ANTHROPIC_API_KEY,   // CLI auth

  // Process limits
  maxConcurrent: parseInt(process.env.CLI2AGENT_MAX_CONCURRENT || '5'),
  requestTimeout: parseInt(process.env.CLI2AGENT_REQUEST_TIMEOUT || '300000'),
  queueDepth: parseInt(process.env.CLI2AGENT_QUEUE_DEPTH || '5'),
  queueTimeout: parseInt(process.env.CLI2AGENT_QUEUE_TIMEOUT || '30000'),

  // Session management
  maxSessions: parseInt(process.env.CLI2AGENT_MAX_SESSIONS || '100'),
  sessionIdleTimeout: parseInt(process.env.CLI2AGENT_SESSION_IDLE_TIMEOUT || '86400000'), // 24h

  // CLI defaults
  defaultModel: process.env.CLI2AGENT_DEFAULT_MODEL || 'claude-sonnet-4-6',
  defaultMaxTurns: parseInt(process.env.CLI2AGENT_DEFAULT_MAX_TURNS || '25'),
  workspace: process.env.CLI2AGENT_WORKSPACE || '/workspace',
};
```

## 12. Implementation Phases

### Phase 1: MVP (Core Loop)
1. Fastify server with health endpoint
2. CLI process spawner (`claude -p --output-format stream-json`)
3. NDJSON parser (line-by-line from stdout)
4. `POST /v1/execute` with SSE streaming
5. Basic session management (create, list, delete)
6. Dockerfile + docker-compose.yml

### Phase 2: Anthropic Compatibility
7. Stream translator state machine (CLI NDJSON → Anthropic SSE)
8. `POST /v1/messages` endpoint
9. Non-streaming response mode
10. Multi-turn conversation support via session resumption

### Phase 3: Production Hardening
11. Concurrency control (per-session mutex, queue)
12. Graceful shutdown and process cleanup
13. Session garbage collection
14. Request timeout and cancellation
15. Error handling and recovery

### Phase 4: Advanced Features
16. Session forking (`POST /v1/sessions/:id/fork`)
17. Bidirectional protocol support (WebSocket upgrade)
18. SDK mode (`query()` function instead of subprocess)
19. MCP configuration passthrough
20. Task status tracking and history
