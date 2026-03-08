# cli2agent — Project Guide

## Overview
cli2agent is a TypeScript/Fastify HTTP service that wraps the Claude Code CLI,
exposing it as a REST and streaming API. It runs inside Docker and manages
concurrent Claude sessions on behalf of callers.

## Key Directories
- `src/routes/`   — Fastify route handlers (session, chat, health, etc.)
- `src/services/` — Core business logic and CLI orchestration
- `src/stream/`   — SSE / streaming response helpers
- `src/schemas/`  — Zod schemas for request/response validation
- `src/types/`    — Shared TypeScript type definitions
- `src/mcp/`      — MCP (Model Context Protocol) integration
- `src/auth/`     — Authentication middleware and helpers

## Build & Dev
- Build:      `npm run build`
- Typecheck:  `npm run typecheck`
- Dev server: `npm run dev`

## Coding Conventions
- TypeScript strict mode with ES modules (`"type": "module"` in package.json)
- Use Zod schemas for all input/output validation
- Follow the Fastify route registration pattern (plugin-based)
- Prefer explicit types over `any`

## Testing
No unit test framework is configured yet. For integration testing use:
```sh
scripts/test-docker.sh
```

## Commit Convention
Use conventional commits: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`.
Example: `feat(routes): add batch chat endpoint`
