# Skills Guide

Skills are pre-packaged instruction sets that enhance what CLI backends can do when orchestrated through cli2agent. This guide covers what skills are, how they work, and how to install and write them.

## What Are Skills?

Skills are instruction files -- typically markdown -- that tell CLI agents **how** to approach tasks. They provide structured workflows, guardrails, and domain-specific knowledge that shape the agent's behavior beyond what a single prompt can achieve.

Examples of skills:

- **TDD workflow**: Forces a red-green-refactor cycle for every code change
- **Code review checklist**: Systematic review covering security, performance, and style
- **Debugging methodology**: Structured approach to isolating and fixing bugs
- **Security audit**: Checks for injection, auth bypass, data exposure, and other vulnerabilities

Different CLI backends have different skill systems, but the underlying concept is the same: a file on disk that the CLI reads to guide its behavior.

## How Skills Work with cli2agent

Skills live on the filesystem inside the container. When cli2agent spawns a CLI process, the CLI reads skills from its configuration directories. cli2agent does not parse or interpret skills -- it is transparent. The CLI backend handles skill loading and execution.

The host's `~/.claude/` directory is bind-mounted into the container. This means skills installed on the host (via the `claude` CLI) are immediately available in the container, and skills installed via the container's Claude CLI persist back to the host.

```
┌──────────────────────────────────┐
│  HTTP Client                     │
│  (sends prompt referencing skill)│
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  cli2agent                       │
│  (passes prompt to CLI backend)  │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  CLI Backend (e.g. Claude Code)  │
│  - Reads skills from filesystem  │
│  - Follows skill instructions    │
│  - Executes tools as directed    │
└──────────────────────────────────┘
```

## Quick Start

Get a skill running end-to-end in four steps:

**1. Create a skill on your host:**

```bash
mkdir -p ~/.claude/commands
cat > ~/.claude/commands/review.md << 'EOF'
# Review
Review code for bugs and security issues.
If no files specified, review uncommitted changes via git diff.
EOF
```

**2. Start the container:**

```bash
docker compose up -d
```

**3. Verify the skill is detected:**

```bash
curl http://localhost:3000/v1/skills
```

Expected response:

```json
{
  "backend": "claude",
  "skills": [
    {
      "name": "review",
      "type": "command",
      "scope": "user",
      "path": "/home/node/.claude/commands/review.md"
    }
  ],
  "total": 1
}
```

**4. Invoke the skill:**

```bash
curl -X POST http://localhost:3000/v1/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt": "/review src/app.ts", "stream": false}'
```

The response includes the full assistant output in `content` blocks. When `stream` is `true`, results arrive as SSE events instead.

## Skill Locations by Backend

Each backend has its own conventions for where skills live. The table below documents known locations.

| Backend | Skill Location (User-level) | Skill Location (Project-level) | Format |
|---------|----------------------------|-------------------------------|--------|
| Claude Code | `/home/node/.claude/commands/` | `/workspace/.claude/commands/` | Markdown (`.md`) |
| Codex | Not yet documented -- contributions welcome | Not yet documented | TBD |
| Gemini | Not yet documented -- contributions welcome | Not yet documented | TBD |
| OpenCode | Not yet documented -- contributions welcome | Not yet documented | TBD |
| Kimi | Not yet documented -- contributions welcome | Not yet documented | TBD |

**Note on Claude Code skills vs. slash commands:** Claude Code has two related concepts. Slash commands live in `.claude/commands/` and are invoked with a `/` prefix (e.g., `/review`). The `Skill` tool loads markdown files from `.claude/` directories programmatically. For cli2agent purposes, both are filesystem-based -- place the files in the right location and the CLI handles the rest.

## Installing Skills

The host's `~/.claude/` directory is bind-mounted into the container at `/home/node/.claude`. This means all skills, commands, settings, and sessions are shared between host and container. No entrypoint scripts or environment variables are needed.

### Method 1: Manage on Host (Recommended)

Install skills using the `claude` CLI on your host machine. They are automatically available in the container via the bind mount.

```bash
# Install a slash command using the Claude CLI
claude commands add review

# Or manually place .md files in the commands directory
mkdir -p ~/.claude/commands
cat > ~/.claude/commands/review.md << 'EOF'
# Code Review

Review the specified files for:
1. Security vulnerabilities
2. Performance issues
3. Code style consistency
4. Missing error handling

Provide a structured summary with severity levels.
EOF
```

Skills appear in the container immediately -- no restart needed.

### Method 2: Workspace-Level Skills (Per-Project)

Place skills in the workspace's `.claude/commands/` directory. These travel with the project and are available to anyone who checks out the repository.

```
workspace/
├── .claude/
│   ├── commands/
│   │   ├── review.md
│   │   └── deploy.md
│   └── settings.json
├── src/
└── ...
```

This works well when skills are project-specific (e.g., a deploy skill that knows your project's deployment process). Since the workspace is mounted as a volume, these skills persist across container restarts.

### Method 3: Bake into Dockerfile (Reproducible Deployments)

For deployments that need guaranteed skill availability without depending on the host filesystem, extend the base Dockerfile and COPY skill files directly into the image.

Add to your `Dockerfile`:

```dockerfile
# Copy custom skills into the image
COPY skills/ /home/node/.claude/commands/
RUN chown -R node:node /home/node/.claude/commands/
```

This ensures skills are always present and version-controlled with your image. Note that if you also use the bind mount, the mounted directory will overlay the baked-in files.

## Listing Installed Skills

Use the `/v1/skills` endpoint to see which skills are available in the running container:

```bash
# List all installed skills
curl http://localhost:3000/v1/skills
```

Response:

```json
{
  "backend": "claude",
  "skills": [
    {
      "name": "review",
      "type": "command",
      "scope": "user",
      "path": "/home/node/.claude/commands/review.md"
    },
    {
      "name": "tdd",
      "type": "command",
      "scope": "workspace",
      "path": "/workspace/.claude/commands/tdd.md"
    }
  ],
  "total": 2
}
```

The same data is available via the MCP `skills_list` tool.

## Writing Skills for cli2agent

Skills running inside cli2agent operate in a headless, containerized environment. Follow these guidelines to ensure they work reliably.

### Guidelines

1. **No interactive input.** Skills must not prompt for confirmation or user input. The CLI runs with `--dangerously-skip-permissions`, so all tool calls execute without approval.

2. **Assume `/workspace` as the working directory.** The CLI's working directory inside the container is always `/workspace`. Use relative paths from there or reference `/workspace` explicitly.

3. **Be explicit about tool restrictions.** If a skill is meant for read-only analysis, state that clearly so it works well when callers pass restrictive `allowed_tools` lists (e.g., `["Read", "Bash(git:*)"]`).

4. **Produce structured output.** Since results are consumed programmatically via the API, prefer structured formats (lists, tables, severity levels) over prose.

5. **Handle missing context gracefully.** The skill might be invoked without arguments. Include fallback behavior (e.g., "if no files are specified, review uncommitted changes").

### Template

Use this as a starting point for new skills:

```markdown
# Skill Name

Brief description of what this skill does.

## Inputs
- Describe what arguments or context the skill expects
- Note any defaults when arguments are missing

## Workflow
1. Step one
2. Step two
3. Step three

## Output Format
Describe the expected output structure.

## Constraints
- List any restrictions (e.g., read-only, no external network calls)
- Note any assumptions about the environment
```

## Using Skills from External Clients

Clients interacting with cli2agent over HTTP do not need special skill support. Skills are transparent -- they exist on the filesystem and the CLI backend reads them automatically.

### Referencing Skill Workflows in Prompts

A client can trigger skill-enhanced execution by referencing the workflow in its prompt:

```json
{
  "session_id": "uuid",
  "prompt": "Follow the TDD workflow to implement a user authentication module",
  "stream": true
}
```

The CLI backend reads the TDD skill from the filesystem and follows its instructions. The client does not need to know that a skill file exists.

### Using Slash Commands (Claude Code)

For Claude Code slash commands, the client includes the command in the prompt:

```json
{
  "session_id": "uuid",
  "prompt": "/review src/auth.ts",
  "stream": true
}
```

Claude Code reads `.claude/commands/review.md` and follows its instructions against the specified file. cli2agent passes the prompt through without modification.

### Using Skills via MCP

If your client connects to cli2agent as an MCP server (at `/mcp`), you can discover and invoke skills through MCP tool calls.

**Discover available skills:**

```json
{
  "tool": "skills_list",
  "arguments": {}
}
```

This returns the same data as `GET /v1/skills` — a list of installed skills with their names, types, scopes, and file paths.

**Invoke a skill via the `execute` tool:**

```json
{
  "tool": "execute",
  "arguments": {
    "prompt": "/review src/auth.ts",
    "max_turns": 10
  }
}
```

The `execute` tool blocks until the CLI finishes and returns the full result as JSON.

### Key Point

Skills are a backend concern. The HTTP API surface does not change. Clients send prompts; the CLI backend decides how to use available skills. This keeps the client simple and the skill system extensible.

## Skill Ecosystem Vision

The skill ecosystem is evolving in several directions:

- **Agent Skills open standard** ([agentskills.io](https://agentskills.io)) aims to define a cross-tool portable format for skills, enabling the same skill files to work across Claude Code, Codex, Gemini, and other backends.
- **Multi-backend skill support** will grow as more CLI backends adopt skill-like systems. The table in this guide will be updated as backends document their conventions.
- **Community skill sharing** is encouraged. The `examples/skills/` directory in this repository contains starter templates. Contributions of new skills and documentation for additional backends are welcome.
