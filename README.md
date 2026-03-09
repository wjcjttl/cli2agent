English | [中文](README.zh-CN.md)

# cli2agent

![CI](https://github.com/wjcjttl/cli2agent/actions/workflows/ci.yml/badge.svg)
![Docker](https://github.com/wjcjttl/cli2agent/actions/workflows/docker.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

A self-hosted Docker service that wraps AI coding CLIs (Claude Code, Codex, Gemini, OpenCode, Kimi) and exposes them as HTTP + SSE + MCP endpoints. Keep your AI-powered tools running — even when provider access gets disrupted.

> **Disclaimer:** cli2agent wraps the Claude Code CLI, which is governed by
> [Anthropic's terms of service](https://www.anthropic.com/policies/usage).
> Automating or exposing the CLI via API may not be permitted under those terms.
> Review Anthropic's policies before use. This software is provided "as is"
> under the MIT License — see [LICENSE](LICENSE) for details.

---

## Why cli2agent?

**Keep your AI workflows running when access gets disrupted.** Recent ban waves from major model providers have left teams scrambling — Slack bots go silent, CI/CD pipelines break, and multi-agent orchestrators lose their backbone overnight. If you rely on Claude Code to power tools like OpenClaw, Cline, or custom integrations, a single account restriction can take everything down.

cli2agent is the resilience layer between your tools and AI coding agents:

- **Uninterrupted access for your tools** — OpenClaw, Slack bots, CI/CD pipelines, and orchestrators call cli2agent's API. If your auth path changes, update one env var — every downstream integration keeps working.
- **Multiple auth paths** — API key, OAuth (Claude Pro/Max), AWS Bedrock, Google Vertex AI. If one path gets restricted, switch to another without changing a line of code in your integrations.
- **Multi-backend failover** — not just Claude. Switch `CLI2AGENT_CLI_BACKEND` to `codex`, `gemini`, `opencode`, or `kimi` and keep your workflows running on a different provider entirely.
- **Self-hosted, fully under your control** — your infrastructure, your credentials, your uptime. No dependency on any provider's web UI, desktop app, or platform availability.
- **One API for everything** — expose any AI coding CLI as HTTP + SSE + MCP endpoints. Build once against cli2agent, swap backends freely.

---

## Features

- **Multi-CLI backend support** — pluggable adapter system for Claude Code, Codex, Gemini CLI, OpenCode, and Kimi Code; switch backends via a single environment variable
- **Session management** — create, list, inspect, and delete named sessions backed by SQLite; sessions persist across requests via CLI session files
- **Agentic task execution** — send prompts to `POST /v1/execute` and stream back thinking, text, tool use, and tool results in real time via SSE
- **Anthropic Messages API compatibility** — `POST /v1/messages` accepts the standard Anthropic request format; drop-in backend for Cline, Cursor, LangChain, and the Anthropic SDK
- **Docker-first** — single `docker compose up` gets you running; no Node.js toolchain required on the host
- **Proxy-level auth** — optional `CLI2AGENT_API_KEY` to gate access to the service, separate from your upstream credentials
- **Configurable concurrency** — process execution is sequential by default; set `CLI2AGENT_MAX_CONCURRENT` to allow parallel CLI processes, with automatic request queuing when all slots are busy
- **Resource-safe** — runs as a non-root user, enforces CPU/memory limits, and cleans up CLI processes on client disconnect or timeout

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Client (Cline / Cursor / SDK / Orchestrator)    │
└─────────────────────┬────────────────────────────┘
                      │ HTTP (REST + SSE)
                      ▼
┌──────────────────────────────────────────────────┐
│  cli2agent  (Node.js / TypeScript / Fastify)     │
│                                                  │
│  ┌────────────┐ ┌──────────────┐ ┌────────────┐ │
│  │ API Routes │ │Session Mgr   │ │Stream      │ │
│  │            │ │(SQLite)      │ │Translator  │ │
│  └─────┬──────┘ └──────┬───────┘ │NDJSON→SSE  │ │
│        │               │         └──────┬─────┘ │
│  ┌─────▼───────────────▼────────────────▼─────┐ │
│  │        CLI Process Manager + Adapters      │ │
│  │   Adapter normalizes each CLI's output     │ │
│  │   into a common NDJSON event format        │ │
│  └────────────────────┬───────────────────────┘ │
└───────────────────────┼──────────────────────────┘
                        │ stdin/stdout (NDJSON/JSONL)
                        ▼
┌──────────────────────────────────────────────────┐
│  CLI Backend (selected via CLI2AGENT_CLI_BACKEND)│
│                                                  │
│  Claude Code ─ Codex ─ Gemini ─ OpenCode ─ Kimi │
└──────────────────────────────────────────────────┘
```

---

## Quick Start

### Docker (recommended)

```bash
# 1. Clone the repo
git clone https://github.com/wjcjttl/cli2agent.git
cd cli2agent

# 2. Set your Anthropic API key
export ANTHROPIC_API_KEY=sk-ant-...

# 3. Start the service (mounts ./workspace into the container)
docker compose up
```

The service is now listening at `http://localhost:3000`.

To point it at an existing project:

```bash
WORKSPACE_PATH=/path/to/your/project docker compose up
```

### Pre-built Image (ghcr.io)

Tagged releases publish a multi-arch (`amd64`/`arm64`) image to GitHub Container Registry:

```bash
docker pull ghcr.io/wjcjttl/cli2agent:latest

# Or pin to a minor version
docker pull ghcr.io/wjcjttl/cli2agent:0.3
```

Run it directly:

```bash
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v /path/to/project:/workspace:rw \
  ghcr.io/wjcjttl/cli2agent:latest
```

### Local Development

```bash
npm install
npm run build
ANTHROPIC_API_KEY=sk-ant-... node dist/server.js
```

Requires Node.js 20+ and `@anthropic-ai/claude-code` installed globally (`npm install -g @anthropic-ai/claude-code`).

---

## Authentication

cli2agent needs credentials to call Anthropic on your behalf. All authentication is configured **outside** the container and passed in via environment variables or mounted files — no interactive login inside the container.

The `/health` endpoint reports which auth method was detected.

### Option 1: API Key (recommended)

The simplest method. Works with any Anthropic API plan. A separate auth path from OAuth — useful as a fallback if your consumer plan is disrupted.

```bash
docker run -e ANTHROPIC_API_KEY=sk-ant-api03-... cli2agent
```

Get an API key at [console.anthropic.com](https://console.anthropic.com/).

### Option 2: Custom API endpoint (LiteLLM, OpenRouter, etc.)

Point the CLI at a custom gateway by setting both the key and the base URL:

```bash
docker run \
  -e ANTHROPIC_API_KEY=sk-your-gateway-key \
  -e ANTHROPIC_BASE_URL=https://your-gateway.example.com \
  cli2agent
```

### Option 3: OAuth Token (Claude Pro/Max subscribers)

> **Note:** OAuth tokens are tied to your consumer plan. If your plan is restricted, this method will stop working. cli2agent supports multiple auth methods — you can switch to API key (Option 1) or Bedrock/Vertex (Option 4/5) without changing any downstream integrations.

Authenticate on your **host machine** first, then mount the token file into the container:

```bash
# 1. On your host: complete the OAuth login
claude auth login

# 2. Mount the token file (read-only) into the container
docker run \
  -v ~/.config/claude/auth.json:/home/node/.config/claude/auth.json:ro \
  cli2agent
```

Override the token path inside the container with `CLAUDE_AUTH_TOKEN_PATH` if needed.

> **Note:** OAuth tokens may expire. If you see auth errors, re-run `claude auth login` on the host and restart the container.

### Option 4: Amazon Bedrock

Use Claude via AWS Bedrock. An independent auth path governed by your AWS agreement — useful for teams that need guaranteed availability or as a fallback when other auth methods are disrupted.

```bash
docker run \
  -e CLAUDE_CODE_USE_BEDROCK=1 \
  -e ANTHROPIC_BEDROCK_BASE_URL=https://bedrock-runtime.us-east-1.amazonaws.com \
  -e AWS_ACCESS_KEY_ID=... \
  -e AWS_SECRET_ACCESS_KEY=... \
  -e AWS_DEFAULT_REGION=us-east-1 \
  cli2agent
```

### Option 5: Google Vertex AI

Use Claude via Google Cloud. Like Bedrock, an independent auth path governed by your GCP agreement.

```bash
docker run \
  -e CLAUDE_CODE_USE_VERTEX=1 \
  -e ANTHROPIC_VERTEX_PROJECT_ID=my-gcp-project \
  -e CLOUD_ML_REGION=us-east5 \
  cli2agent
```

### Detection priority

The service checks for credentials in this order at startup:

1. `ANTHROPIC_API_KEY` (with or without `ANTHROPIC_BASE_URL`)
2. `CLAUDE_CODE_USE_BEDROCK=1` + `ANTHROPIC_BEDROCK_BASE_URL`
3. `CLAUDE_CODE_USE_VERTEX=1` + `ANTHROPIC_VERTEX_PROJECT_ID`
4. OAuth token file at `~/.config/claude/auth.json` (or `CLAUDE_AUTH_TOKEN_PATH`)

If none are found, the server still starts but logs a warning and `/health` reports `"method": "none"`.

---

## Supported CLI Backends

cli2agent supports multiple AI coding CLIs through a pluggable adapter system. Each adapter handles binary resolution, argument building, environment setup, and output normalization for its respective CLI.

Set the backend via the `CLI2AGENT_CLI_BACKEND` environment variable (default: `claude`).

| Backend | CLI Binary | Package | Headless Command | Auth |
|---------|-----------|---------|-----------------|------|
| `claude` | `claude` | `@anthropic-ai/claude-code` | `claude -p "prompt" --output-format stream-json` | `ANTHROPIC_API_KEY`, OAuth, Bedrock, Vertex |
| `codex` | `codex` | `@openai/codex` | `codex "prompt" --json --full-auto` | `OPENAI_API_KEY` |
| `gemini` | `gemini` | `@google/gemini-cli` | `gemini "prompt" --output-format stream-json --approval-mode=yolo` | `GEMINI_API_KEY`, Google OAuth |
| `opencode` | `opencode` | `opencode-ai` | `opencode run "prompt" --format json` | Provider-dependent (configured in opencode config) |
| `kimi` | `kimi` | `kimi-cli` (pip) | `kimi --print -p "prompt" --output-format stream-json --yolo` | `kimi login` (Moonshot OAuth) |

### Usage

```bash
# Use Gemini CLI as the backend
docker run -p 3000:3000 \
  -e CLI2AGENT_CLI_BACKEND=gemini \
  -e GEMINI_API_KEY=... \
  ghcr.io/wjcjttl/cli2agent:latest

# Use Codex as the backend
docker run -p 3000:3000 \
  -e CLI2AGENT_CLI_BACKEND=codex \
  -e OPENAI_API_KEY=sk-... \
  ghcr.io/wjcjttl/cli2agent:latest
```

### How adapters work

Each adapter implements a common interface:

- **`resolveBinary()`** — Locates the CLI binary (checks env override, `which`, then falls back to name)
- **`buildArgs()`** — Builds CLI-specific flags (prompt, model, session resume, workspace, etc.)
- **`buildEnv()`** — Sets environment variables for the subprocess
- **`normalizeEvent()`** — Translates CLI-specific NDJSON/JSONL events into cli2agent's standard event format

The API surface (`/v1/execute`, `/v1/messages`, `/v1/sessions`) remains identical regardless of which backend is selected. All output normalization happens transparently inside the adapter layer.

### Binary override

Each adapter supports a `*_BIN` environment variable to specify a custom binary path:

| Variable | Backend |
|----------|---------|
| `CLAUDE_BIN` | `claude` |
| `CODEX_BIN` | `codex` |
| `GEMINI_BIN` | `gemini` |
| `OPENCODE_BIN` | `opencode` |
| `KIMI_BIN` | `kimi` |

---

## API Reference

All endpoints are prefixed with no version except the core ones listed below. The `x-api-key` header (or `Authorization: Bearer <key>`) is required when `CLI2AGENT_API_KEY` is set.

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Returns `{"status":"ok"}` — used by Docker healthcheck |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/sessions` | Create a new session |
| `GET` | `/v1/sessions` | List sessions (query: `status`, `workspace`, `limit`, `offset`) |
| `GET` | `/v1/sessions/:id` | Get session details including token usage and message count |
| `DELETE` | `/v1/sessions/:id` | Delete session; use `?force=true` to kill an active process |
| `POST` | `/v1/sessions/:id/fork` | Fork an existing session at a given message |

**Create session request:**
```json
{
  "workspace": "/workspace",
  "name": "Feature X",
  "model": "claude-sonnet-4-6"
}
```

### Skills

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/skills` | List installed skills (slash commands) from user and workspace directories |

### Execute (agentic)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/execute` | Run an agentic prompt; streams SSE events when `"stream": true` |
| `POST` | `/v1/execute/:task_id/cancel` | Cancel a running task (SIGTERM → SIGKILL after 5 s) |

**Request:**
```json
{
  "session_id": "uuid",
  "prompt": "Refactor auth.py to use dependency injection",
  "stream": true,
  "include_thinking": true,
  "max_turns": 10,
  "allowed_tools": ["Read", "Edit", "Bash"],
  "system_prompt": "You are a senior Python engineer.",
  "model": "claude-sonnet-4-6"
}
```

**SSE event stream:**
```
event: task_start
data: {"task_id":"...","session_id":"...","status":"running"}

event: thinking_delta
data: {"text":"Let me analyze the current structure..."}

event: text_delta
data: {"text":"I'll refactor auth.py to use dependency injection. "}

event: tool_use
data: {"tool":"Read","input":{"file_path":"auth.py"}}

event: tool_result
data: {"tool":"Read","output":"class AuthService:...","duration_ms":45}

event: task_complete
data: {"task_id":"...","status":"completed","duration_ms":12340,"turns":3}
```

`session_id` is optional — if omitted, a new session is created automatically and its ID is returned in `task_start`.

### Messages (Anthropic-compatible)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/messages` | Drop-in replacement for the Anthropic Messages API |

Accepts the standard `messages`, `model`, `system`, `stream`, `max_tokens`, and `thinking` fields. Responses follow the Anthropic SSE format (`message_start`, `content_block_start`, `content_block_delta`, etc.) so existing Anthropic SDK clients work without modification.

**Compatibility notes:**

| Feature | Status |
|---------|--------|
| Single-turn text messages | Supported |
| Streaming (SSE) | Supported |
| Non-streaming | Supported |
| System prompts | Supported |
| Thinking blocks | Supported |
| Multi-turn (via sessions) | Partial |
| Tool use blocks (CLI built-ins) | Partial |
| Custom tool definitions | Not supported |
| Vision / image inputs | Not supported |
| Exact token counts | Best-effort |

---

## Skills

cli2agent supports Claude Code skills (slash commands) — markdown instruction files that guide the agent's behavior during execution. Skills are discovered automatically from `~/.claude/commands/` (user-level) and `/workspace/.claude/commands/` (project-level). See the [Skills Guide](docs/skills.md) for full details, and `examples/skills/claude-code/` for ready-to-use skill templates.

---

## Configuration

All configuration is via environment variables.

**Service configuration:**

| Variable | Default | Description |
|----------|---------|-------------|
| `CLI2AGENT_CLI_BACKEND` | `claude` | CLI backend to use: `claude`, `codex`, `gemini`, `opencode`, `kimi` |
| `CLI2AGENT_LOG_LEVEL` | `info` | Log level for service and Fastify logger (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `CLI2AGENT_PORT` | `3000` | Port the HTTP server listens on |
| `CLI2AGENT_HOST` | `0.0.0.0` | Host/interface to bind |
| `CLI2AGENT_API_KEY` | — | If set, clients must send this key via `x-api-key` or `Authorization: Bearer` |
| `CLI2AGENT_WORKSPACE` | `/workspace` | Default working directory passed to the CLI |
| `CLI2AGENT_DEFAULT_MODEL` | _(CLI default)_ | Default Claude model for requests that don't specify one |
| `CLI2AGENT_DEFAULT_MAX_TURNS` | `25` | Default agentic loop turn limit |
| `CLI2AGENT_MAX_CONCURRENT` | `1` | Maximum concurrent CLI processes (sequential by default) |
| `CLI2AGENT_QUEUE_TIMEOUT` | `30000` | How long a request waits for a process slot before returning 429 (ms) |
| `CLI2AGENT_REQUEST_TIMEOUT` | `300000` | Per-request timeout in milliseconds (5 minutes) |
| `CLI2AGENT_MAX_SESSIONS` | `100` | Maximum number of tracked sessions |
| `DISABLE_AUTOUPDATER` | `1` (in Docker) | Prevent Claude Code from self-updating inside the container |

**Claude authentication** (see [Authentication](#authentication) for usage):

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Anthropic API key (recommended) |
| `ANTHROPIC_BASE_URL` | — | Custom API endpoint (LiteLLM, OpenRouter, etc.) |
| `CLAUDE_CODE_USE_BEDROCK` | — | Set to `1` to use Amazon Bedrock |
| `ANTHROPIC_BEDROCK_BASE_URL` | — | Bedrock endpoint URL (required when Bedrock is enabled) |
| `CLAUDE_CODE_USE_VERTEX` | — | Set to `1` to use Google Vertex AI |
| `ANTHROPIC_VERTEX_PROJECT_ID` | — | GCP project ID (required when Vertex is enabled) |
| `CLAUDE_AUTH_TOKEN_PATH` | `~/.config/claude/auth.json` | Path to OAuth token file inside container |

### Volume mounts

| Container path | Purpose |
|----------------|---------|
| `/workspace` | Code repository Claude operates on (mount your project here) |
| `/workspace/CLAUDE.md` | Project-level system prompt; read automatically by the CLI |
| `/workspace/.mcp.json` | MCP server configuration |
| `/home/node/.claude/` | Session JSONL files and user-scope settings (persisted via named volume) |
| `/home/node/.config/claude/auth.json` | OAuth credentials (mount read-only if using OAuth auth) |

---

## Roadmap

### Phase 1 — MVP (Core Loop)
- [x] Fastify server with `/health` endpoint
- [x] CLI process spawner (`claude -p --output-format stream-json`)
- [x] NDJSON line-by-line parser from stdout
- [x] `POST /v1/execute` with SSE streaming
- [x] Basic session management (create, list, delete)
- [x] Dockerfile + docker-compose.yml

### Phase 2 — Anthropic Compatibility
- [ ] Stream translator state machine (CLI NDJSON to Anthropic SSE)
- [ ] `POST /v1/messages` endpoint
- [x] Non-streaming response mode
- [x] Multi-turn conversation support via session resumption

### Phase 3 — Production Hardening
- [x] Per-session concurrency mutex and request queue
- [x] Graceful shutdown and process cleanup
- [ ] Session garbage collection (idle timeout)
- [ ] Request cancellation (`/v1/execute/:id/cancel`)
- [x] Structured error handling and recovery

### Phase 4 — Advanced Features
- [ ] Session forking (`POST /v1/sessions/:id/fork`)
- [ ] Bidirectional protocol support (WebSocket upgrade for interactive permission prompts)
- [ ] SDK mode (`query()` function instead of subprocess spawning)
- [x] MCP configuration passthrough per request
- [ ] Task history and status tracking

---

## License

MIT — see [LICENSE](LICENSE).
