# cli2agent Integration Guide

cli2agent exposes the Claude Code CLI as a set of HTTP + SSE API endpoints. This guide covers everything you need to integrate cli2agent into your application, orchestrator, or AI toolchain.

## Guides

| Guide | Description |
|-------|-------------|
| [Session Management](sessions.md) | Create, list, inspect, delete, and fork sessions. Lifecycle management and best practices. |
| [Agentic Execution](execute.md) | Send prompts via `POST /v1/execute`, stream SSE events, handle tool use, and manage tasks. |
| [Anthropic Messages API Compatibility](messages.md) | Use cli2agent as a drop-in backend for Cline, Cursor, LangChain, and the Anthropic SDKs. |
| [OpenClaw Integration](openclaw.md) | Delegate tasks from OpenClaw to cli2agent via REST API or MCP. Includes skill pre-installation and security hardening. |

## Prerequisites

### Base URL

By default, cli2agent listens on:

```
http://localhost:3000
```

The port is configurable via the `CLI2AGENT_PORT` environment variable.

### Authentication

If the server is configured with `CLI2AGENT_API_KEY`, every request must include the key in one of two ways:

**Header: `x-api-key`**

```
x-api-key: cli2agent-key-xxx
```

**Header: `Authorization` (Bearer)**

```
Authorization: Bearer cli2agent-key-xxx
```

If `CLI2AGENT_API_KEY` is not set on the server, no client authentication is required.

### Required Headers

All `POST` requests must include:

```
Content-Type: application/json
```

### Health Check

Verify the server is running before making API calls:

```bash
curl http://localhost:3000/health
```

```json
{"status": "ok"}
```

## Common Error Format

All error responses follow a consistent structure:

```json
{
  "error": "error_code",
  "message": "Human-readable description of the problem"
}
```

| HTTP Status | Meaning |
|-------------|---------|
| `400` | Bad request (invalid parameters) |
| `404` | Resource not found |
| `409` | Conflict (session is busy) |
| `429` | Too many requests (all process slots busy) |
| `500` | Internal server error |
| `501` | Not implemented |
