# Contributing to cli2agent

Thanks for your interest in contributing! This guide covers what you need to get started.

## Prerequisites

- Node.js 20+
- Docker and Docker Compose (for container-based development)
- `@anthropic-ai/claude-code` installed globally (`npm install -g @anthropic-ai/claude-code`) for local runs

## Local Development

```bash
# Install dependencies
npm install

# Run in watch mode (auto-restarts on file changes)
npm run dev

# Or use Make
make dev
```

The server starts at `http://localhost:3000`. You need `ANTHROPIC_API_KEY` set in your environment (or another auth method — see README).

## Docker Development

```bash
# Start the dev container with live reload
make dev-up

# View logs
make dev-logs

# Stop and clean up
make dev-down

# Rebuild after package.json changes
make dev-rebuild
```

## Type Checking

```bash
npm run typecheck
# or
make typecheck
```

There is no linter configured yet. Follow the existing code style: TypeScript strict mode, ES modules, explicit types on public APIs.

## Running Tests

```bash
# Docker integration tests (requires ANTHROPIC_API_KEY)
bash scripts/test-docker.sh
# or
make docker-test
```

## Making Changes

1. **Fork** the repository and clone your fork.
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
3. **Make your changes.** Keep commits focused and atomic.
4. **Type-check** before pushing: `npm run typecheck`
5. **Push** your branch and open a Pull Request against `main`.

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code change that neither fixes a bug nor adds a feature
- `test:` — adding or updating tests
- `chore:` — maintenance (deps, CI, build scripts)

Example: `feat(sessions): add session fork endpoint`

## Project Structure

```
src/
  server.ts          — Fastify server entry point
  routes/            — API route handlers
  services/          — Business logic (session manager, CLI process manager)
  lib/               — Shared utilities and types
scripts/             — Test and helper scripts
```

## Questions?

Open an issue on GitHub. There are no formal channels yet — issues are the best way to discuss ideas or problems.
