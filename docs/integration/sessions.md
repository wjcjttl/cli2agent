# Session Management Integration Guide

Sessions are the core abstraction for maintaining conversation context across multiple prompts. A session maps to a Claude Code JSONL file on disk, preserving the full conversation history so that subsequent prompts have access to prior context.

## Session Lifecycle

```
POST /v1/sessions --> idle
                        |
      POST /v1/execute  |  (prompt submitted)
                        v
                      active  (CLI process running)
                        |
              +---------+-----------+
              v         v           v
            idle      errored    (client disconnect
          (success)   (crash)      -> kill process -> idle)
              |
    DELETE /v1/sessions/:id
              v
           deleted
```

A session starts in the **idle** state. When a prompt is submitted via `/v1/execute`, the session transitions to **active** while the CLI process runs. On completion it returns to **idle**; on failure it moves to **errored**. Deleting a session removes it permanently.

Only one prompt can execute against a session at a time. Concurrent requests to an active session return `409 Conflict`.

## Create a Session

```
POST /v1/sessions
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `workspace` | string | No | Working directory for Claude Code. Defaults to `/workspace`. |
| `name` | string | No | Human-readable label for the session. |
| `model` | string | No | Claude model to use (e.g., `claude-sonnet-4-6`). |

No CLI process is spawned at creation time -- this only reserves a UUID and records metadata in SQLite.

### curl

```bash
curl -X POST http://localhost:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -H "x-api-key: cli2agent-key-xxx" \
  -d '{
    "workspace": "/workspace",
    "name": "Refactor auth module",
    "model": "claude-sonnet-4-6"
  }'
```

### Response (201 Created)

```json
{
  "id": "a30b1391-3602-45c0-9cd0-c17ea41577b7",
  "status": "idle",
  "workspace": "/workspace",
  "name": "Refactor auth module",
  "model": "claude-sonnet-4-6",
  "message_count": 0,
  "created_at": "2026-03-07T10:30:00.000Z",
  "updated_at": "2026-03-07T10:30:00.000Z",
  "total_input_tokens": 0,
  "total_output_tokens": 0
}
```

## List Sessions

```
GET /v1/sessions
```

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status: `idle`, `active`, or `errored`. |
| `workspace` | string | Filter by workspace path. |
| `limit` | string | Maximum number of results (default: 50). |
| `offset` | string | Number of results to skip for pagination. |

### curl

```bash
# List all sessions
curl http://localhost:3000/v1/sessions \
  -H "x-api-key: cli2agent-key-xxx"

# List only idle sessions, page 2
curl "http://localhost:3000/v1/sessions?status=idle&limit=10&offset=10" \
  -H "x-api-key: cli2agent-key-xxx"

# Filter by workspace
curl "http://localhost:3000/v1/sessions?workspace=/workspace" \
  -H "x-api-key: cli2agent-key-xxx"
```

### Response (200 OK)

```json
{
  "sessions": [
    {
      "id": "a30b1391-3602-45c0-9cd0-c17ea41577b7",
      "status": "idle",
      "workspace": "/workspace",
      "name": "Refactor auth module",
      "model": "claude-sonnet-4-6",
      "message_count": 5,
      "created_at": "2026-03-07T10:30:00.000Z",
      "updated_at": "2026-03-07T11:15:00.000Z",
      "total_input_tokens": 12500,
      "total_output_tokens": 3400
    }
  ],
  "total": 1
}
```

## Get Session Details

```
GET /v1/sessions/:id
```

Returns the full session object including cumulative token usage and message count.

### curl

```bash
curl http://localhost:3000/v1/sessions/a30b1391-3602-45c0-9cd0-c17ea41577b7 \
  -H "x-api-key: cli2agent-key-xxx"
```

### Response (200 OK)

```json
{
  "id": "a30b1391-3602-45c0-9cd0-c17ea41577b7",
  "status": "idle",
  "workspace": "/workspace",
  "name": "Refactor auth module",
  "model": "claude-sonnet-4-6",
  "message_count": 5,
  "created_at": "2026-03-07T10:30:00.000Z",
  "updated_at": "2026-03-07T11:15:00.000Z",
  "total_input_tokens": 12500,
  "total_output_tokens": 3400
}
```

### Error (404 Not Found)

```json
{
  "error": "not_found",
  "message": "Session not found"
}
```

## Delete a Session

```
DELETE /v1/sessions/:id
```

Removes the session from the database and cleans up resources.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `force` | string | Set to `"true"` to delete an active session (kills the running CLI process). |

### curl

```bash
# Delete an idle session
curl -X DELETE http://localhost:3000/v1/sessions/a30b1391-3602-45c0-9cd0-c17ea41577b7 \
  -H "x-api-key: cli2agent-key-xxx"

# Force-delete an active session
curl -X DELETE "http://localhost:3000/v1/sessions/a30b1391-3602-45c0-9cd0-c17ea41577b7?force=true" \
  -H "x-api-key: cli2agent-key-xxx"
```

### Response (204 No Content)

No response body on success.

### Error (409 Conflict)

Returned when attempting to delete an active session without `force=true`:

```json
{
  "error": "session_active",
  "message": "Session is active. Use force=true to delete."
}
```

## Fork a Session

```
POST /v1/sessions/:id/fork
```

Creates a new session that branches from an existing session's conversation history at a specific message. This is useful for exploring alternative approaches without losing the original conversation.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | No | Name for the forked session. |
| `after_message_id` | string | No | UUID of the message to fork after. If omitted, forks from the latest message. |

### curl

```bash
curl -X POST http://localhost:3000/v1/sessions/a30b1391-3602-45c0-9cd0-c17ea41577b7/fork \
  -H "Content-Type: application/json" \
  -H "x-api-key: cli2agent-key-xxx" \
  -d '{
    "name": "Experiment: alternative DI pattern",
    "after_message_id": "msg-uuid-from-conversation"
  }'
```

### Response (201 Created)

```json
{
  "id": "b41c2402-4713-56d1-0de1-d28fb52688c8",
  "forked_from": "a30b1391-3602-45c0-9cd0-c17ea41577b7",
  "status": "idle"
}
```

## Error Handling

| Status | Error Code | Cause | Resolution |
|--------|------------|-------|------------|
| `404` | `not_found` | Session ID does not exist | Check the session ID or list sessions to find valid IDs. |
| `409` | `session_active` | Attempted to delete an active session | Wait for the task to complete, or use `?force=true`. |
| `409` | `session_busy` | Submitted a prompt to an active session | Wait for the current task to finish before submitting another. |
| `500` | `create_failed` | Session creation failed (e.g., max sessions reached) | Delete unused sessions or increase `CLI2AGENT_MAX_SESSIONS`. |
| `500` | `delete_failed` | Internal error during deletion | Check server logs. |

## Python Example

```python
import requests

BASE_URL = "http://localhost:3000"
HEADERS = {
    "Content-Type": "application/json",
    "x-api-key": "cli2agent-key-xxx",
}


def create_session(name: str, workspace: str = "/workspace") -> dict:
    resp = requests.post(
        f"{BASE_URL}/v1/sessions",
        headers=HEADERS,
        json={"name": name, "workspace": workspace},
    )
    resp.raise_for_status()
    return resp.json()


def list_sessions(status: str | None = None, limit: int = 50) -> dict:
    params = {"limit": str(limit)}
    if status:
        params["status"] = status
    resp = requests.get(f"{BASE_URL}/v1/sessions", headers=HEADERS, params=params)
    resp.raise_for_status()
    return resp.json()


def get_session(session_id: str) -> dict:
    resp = requests.get(f"{BASE_URL}/v1/sessions/{session_id}", headers=HEADERS)
    resp.raise_for_status()
    return resp.json()


def delete_session(session_id: str, force: bool = False) -> None:
    params = {"force": "true"} if force else {}
    resp = requests.delete(
        f"{BASE_URL}/v1/sessions/{session_id}", headers=HEADERS, params=params
    )
    resp.raise_for_status()


# Usage
session = create_session("Bug fix: login timeout")
print(f"Created session: {session['id']}")

all_sessions = list_sessions(status="idle")
print(f"Found {all_sessions['total']} idle sessions")

details = get_session(session["id"])
print(f"Token usage: {details['total_input_tokens']} in / {details['total_output_tokens']} out")

delete_session(session["id"])
print("Session deleted")
```

## JavaScript / TypeScript Example

```typescript
const BASE_URL = "http://localhost:3000";
const HEADERS = {
  "Content-Type": "application/json",
  "x-api-key": "cli2agent-key-xxx",
};

async function createSession(name: string, workspace = "/workspace") {
  const resp = await fetch(`${BASE_URL}/v1/sessions`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ name, workspace }),
  });
  if (!resp.ok) throw new Error(`Create failed: ${resp.status}`);
  return resp.json();
}

async function listSessions(status?: string, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (status) params.set("status", status);
  const resp = await fetch(`${BASE_URL}/v1/sessions?${params}`, {
    headers: HEADERS,
  });
  if (!resp.ok) throw new Error(`List failed: ${resp.status}`);
  return resp.json();
}

async function getSession(sessionId: string) {
  const resp = await fetch(`${BASE_URL}/v1/sessions/${sessionId}`, {
    headers: HEADERS,
  });
  if (!resp.ok) throw new Error(`Get failed: ${resp.status}`);
  return resp.json();
}

async function deleteSession(sessionId: string, force = false) {
  const params = force ? "?force=true" : "";
  const resp = await fetch(`${BASE_URL}/v1/sessions/${sessionId}${params}`, {
    method: "DELETE",
    headers: HEADERS,
  });
  if (!resp.ok) throw new Error(`Delete failed: ${resp.status}`);
}

// Usage
const session = await createSession("Bug fix: login timeout");
console.log(`Created session: ${session.id}`);

const allSessions = await listSessions("idle");
console.log(`Found ${allSessions.total} idle sessions`);

const details = await getSession(session.id);
console.log(`Tokens: ${details.total_input_tokens} in / ${details.total_output_tokens} out`);

await deleteSession(session.id);
console.log("Session deleted");
```

## Best Practices

### Reuse Sessions for Related Tasks

Sessions accumulate conversation context. When working on a related set of changes, reuse the same session so Claude has full history:

```bash
# First prompt in the session
curl -X POST http://localhost:3000/v1/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: cli2agent-key-xxx" \
  -d '{"session_id": "a30b1391-...", "prompt": "Read auth.py and explain the current structure"}'

# Follow-up prompt in the same session (Claude remembers the prior context)
curl -X POST http://localhost:3000/v1/execute \
  -H "Content-Type: application/json" \
  -H "x-api-key: cli2agent-key-xxx" \
  -d '{"session_id": "a30b1391-...", "prompt": "Now refactor it to use dependency injection"}'
```

### Clean Up Finished Sessions

Sessions consume storage (SQLite rows and JSONL files on disk). Delete sessions that are no longer needed:

```bash
# Periodically clean up old idle sessions
for id in $(curl -s http://localhost:3000/v1/sessions?status=idle \
  -H "x-api-key: cli2agent-key-xxx" | jq -r '.sessions[].id'); do
  curl -s -X DELETE "http://localhost:3000/v1/sessions/$id" \
    -H "x-api-key: cli2agent-key-xxx"
done
```

### Use Descriptive Names

Session names make it easy to identify what each session is for when listing:

```json
{
  "name": "JIRA-1234: Fix login timeout on mobile",
  "workspace": "/workspace"
}
```

### Handle the 409 Conflict Gracefully

When orchestrating multiple tasks, check session status before submitting a prompt, or handle the 409 with a retry:

```python
import time

def execute_with_retry(session_id: str, prompt: str, max_retries: int = 3):
    for attempt in range(max_retries):
        resp = requests.post(
            f"{BASE_URL}/v1/execute",
            headers=HEADERS,
            json={"session_id": session_id, "prompt": prompt},
        )
        if resp.status_code == 409:
            wait = 2 ** attempt
            print(f"Session busy, retrying in {wait}s...")
            time.sleep(wait)
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError("Session remained busy after retries")
```

### Monitor Token Usage

Track cumulative token usage per session to manage costs:

```python
session = get_session("a30b1391-...")
total_tokens = session["total_input_tokens"] + session["total_output_tokens"]
if total_tokens > 100_000:
    print(f"Warning: session has used {total_tokens} tokens")
```
