# cli2agent Executor -- OpenClaw Skill

An OpenClaw skill that delegates tasks to Claude Code via [cli2agent](https://github.com/anthropics/cli2agent). Use it for multi-step agentic execution, code work, research, and tool use from any OpenClaw channel.

## Prerequisites

- **cli2agent** running and reachable (Docker or local). Default: `http://localhost:3000`
- **Python 3.10+**
- **uv** (recommended) or `pip`

## Installation

### Option 1: Copy into OpenClaw skills directory

```bash
# Copy the skill into your OpenClaw skills directory
cp -r examples/openclaw-skill/ ~/.openclaw/skills/cli2agent-executor/

# Or into a workspace-specific skills directory
cp -r examples/openclaw-skill/ ./skills/cli2agent-executor/
```

### Option 2: Symlink for development

```bash
ln -s "$(pwd)/examples/openclaw-skill" ~/.openclaw/skills/cli2agent-executor
```

### Install dependencies

```bash
cd ~/.openclaw/skills/cli2agent-executor
uv sync
```

Or with pip:

```bash
pip install httpx>=0.27
```

## Configuration

### cli2agent URL

Set the `CLI2AGENT_URL` environment variable to point to your cli2agent instance:

```bash
export CLI2AGENT_URL="http://localhost:3000"
```

If not set, the skill defaults to `http://localhost:3000`.

For Docker-to-Docker connectivity (when both OpenClaw and cli2agent run in containers):

```bash
export CLI2AGENT_URL="http://host.docker.internal:3000"
```

### API Key (optional)

If cli2agent is configured with `CLI2AGENT_API_KEY`:

```bash
export CLI2AGENT_API_KEY="your-secret-key"
```

## Usage

### Basic execution

```bash
uv run cli2agent_skill.py -p "Explain the architecture of this codebase"
```

### Multi-turn session

```bash
# First turn -- creates a session (prints session UUID to stderr)
uv run cli2agent_skill.py -p "Read the auth module and summarize it"

# Second turn -- resumes the session using the UUID from the first run
uv run cli2agent_skill.py -p "Now add input validation to the login function" -s <SESSION_ID>
```

### Untrusted mode (for external content)

```bash
uv run cli2agent_skill.py -p "Analyze this PR: $(cat pr-diff.txt)" --untrusted
```

This restricts tools to read-only (Read, Glob, Grep), limits to 5 turns, and injects a hardened system prompt.

### JSON output

```bash
uv run cli2agent_skill.py -p "List all TODO comments" --json
```

### Custom model and turn limit

```bash
uv run cli2agent_skill.py -p "Refactor the database layer" -m claude-sonnet-4-6 --max-turns 20
```

### Restrict allowed tools

```bash
uv run cli2agent_skill.py -p "Review this file" --allowed-tools "Read,Grep,Glob"
```

## Customization

### Renaming the skill

1. Edit `SKILL.md` and change the `name` field in the frontmatter.
2. Update the `description` to match your use case.
3. Rename the directory to match.

### Changing defaults

Edit the constants at the top of `cli2agent_skill.py`:

```python
DEFAULT_URL = "http://localhost:3000"    # Default cli2agent endpoint
DEFAULT_MAX_TURNS = 10                    # Default max agentic turns
DEFAULT_TIMEOUT = 300                     # HTTP timeout in seconds
```

### Usage logging

Each invocation is logged to `usage.jsonl` in the skill directory. Each entry includes timestamp, session ID, model, turn count, duration, truncation status, and a prompt preview. Disable with `--no-log`.

## File Structure

```
cli2agent-executor/
  SKILL.md             # OpenClaw skill definition (frontmatter + docs)
  cli2agent_skill.py   # Python script -- session management, SSE streaming
  pyproject.toml       # uv/pip dependencies
  README.md            # This file
  usage.jsonl          # Auto-created usage log (gitignored)
```
