---
name: cli2agent-executor
description: Delegate tasks to AI coding agents via cli2agent for multi-step agentic execution, code work, research, and tool use.
metadata:
  {
    "openclaw":
      {
        "emoji": "\ud83e\udd16",
        "requires": { "bins": ["uv"], "env": [] }
      }
  }
---

# cli2agent Executor -- Agentic Task Delegation

Delegate tasks to a Claude Code instance (via cli2agent) for multi-step agentic execution, tool use, research, and code work.

## When to Use

- **Code work**: Refactoring, debugging, PR review, writing code across files
- **Complex reasoning**: Tasks requiring extended thinking or multi-step analysis
- **Research**: Deep investigation of topics, codebase exploration, architecture review
- **Isolation needed**: Processing untrusted input (GitHub webhooks, external content) -- use `--untrusted` for automatic hardening
- **Second opinion**: When you want an independent agent's judgment on a decision
- **Multi-step tasks**: Anything requiring an agentic loop (read, think, act, verify)

## When NOT to Use

- Simple questions that don't need tools or multi-step reasoning
- Tasks requiring host system access (use your own tools instead)
- Quick text generation or formatting

## Quick Start

```bash
# Basic execution
uv run {baseDir}/cli2agent_skill.py -p "Explain the architecture of this codebase"

# With session persistence (multi-turn)
uv run {baseDir}/cli2agent_skill.py -p "Read the auth module" -s my-session
uv run {baseDir}/cli2agent_skill.py -p "Now refactor it to use dependency injection" -s my-session

# Untrusted mode (read-only, hardened for external input)
uv run {baseDir}/cli2agent_skill.py -p "Analyze this PR diff: $(cat diff.txt)" --untrusted

# JSON output for programmatic consumption
uv run {baseDir}/cli2agent_skill.py -p "List all TODO comments in the codebase" --json

# Custom cli2agent endpoint
uv run {baseDir}/cli2agent_skill.py -p "Run the test suite" --url http://cli2agent:3000
```

## CLI Arguments

| Argument | Short | Default | Description |
|----------|-------|---------|-------------|
| `--prompt` | `-p` | (required) | The task or question to send |
| `--session` | `-s` | (auto) | Session ID to resume; omit for new session |
| `--model` | `-m` | container default | Model override |
| `--max-turns` | | `10` | Max agentic loop turns |
| `--system` | | | System prompt to prepend |
| `--allowed-tools` | | (all) | Comma-separated list of allowed tools |
| `--untrusted` | | false | Read-only tools, 5 max turns, hardened system prompt |
| `--url` | | `http://localhost:3000` | cli2agent endpoint (or set `CLI2AGENT_URL`) |
| `--json` | | false | Output full JSON result |
| `--no-log` | | false | Skip writing to `usage.jsonl` |

## Output Format

**Standard mode** (default): Prints the assistant's response text to stdout. Session metadata (session ID, turn count, duration, truncation status) is printed to stderr.

**JSON mode** (`--json`): Prints the full result object to stdout:

```json
{
  "text": "Here is my analysis of the codebase...",
  "session_id": "a30b1391-3602-45c0-9cd0-c17ea41577b7",
  "turns": 4,
  "duration_ms": 12340,
  "truncated": false
}
```

## Autonomous Continuation Protocol

When the agent's execution is truncated (reaches `max_turns` before completing the task), the `truncated` field is set to `true`. The calling agent should detect this and continue the conversation:

1. Check the `truncated` field in the result.
2. If `true`, re-invoke the skill with the same `--session` and a continuation prompt:

```bash
uv run {baseDir}/cli2agent_skill.py \
  -p "Continue where you left off. Complete the remaining work." \
  -s <session_id_from_previous_run>
```

3. Repeat until `truncated` is `false` or a maximum retry count is reached.

This protocol enables long-running tasks to be completed across multiple invocations while maintaining full conversation context.

## Guardrails

- **Timeout**: Each execution has a 300-second timeout. Long-running tasks should be broken into smaller steps.
- **Max turns**: Default is 10 turns per invocation. Increase with `--max-turns` for complex tasks, but be mindful of cost and latency.
- **Untrusted mode**: Always use `--untrusted` when processing external or user-supplied content. This restricts tools to Read, Glob, and Grep, limits turns to 5, and injects a hardened system prompt.
- **Usage logging**: Each invocation is logged to `usage.jsonl` in the skill directory (disable with `--no-log`). Monitor this file to track cost and detect anomalies.
