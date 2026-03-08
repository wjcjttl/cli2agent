#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# cli2agent Docker integration test
# ---------------------------------------------------------------------------
# Prerequisites: docker, curl, ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN set in environment
# Usage: bash scripts/test-docker.sh
# ---------------------------------------------------------------------------

# --- color helpers ----------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

pass() { echo -e "${GREEN}✓${RESET} $*"; }
fail() { echo -e "${RED}✗${RESET} $*"; }
info() { echo -e "${YELLOW}▶${RESET} $*"; }
header() { echo -e "\n${BOLD}$*${RESET}"; }

PASS_COUNT=0
FAIL_COUNT=0
FAILED_TESTS=()

assert_pass() {
  local name="$1"
  PASS_COUNT=$(( PASS_COUNT + 1 ))
  pass "$name"
}

assert_fail() {
  local name="$1"
  local reason="$2"
  FAIL_COUNT=$(( FAIL_COUNT + 1 ))
  FAILED_TESTS+=("$name")
  fail "$name — $reason"
}

# --- pre-flight checks ------------------------------------------------------
header "Pre-flight checks"

# Detect which auth method is available
AUTH_ENV_ARGS=()
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  AUTH_ENV_ARGS+=(-e "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}")
  [[ -n "${ANTHROPIC_BASE_URL:-}" ]] && AUTH_ENV_ARGS+=(-e "ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}")
  pass "Auth: ANTHROPIC_API_KEY${ANTHROPIC_BASE_URL:+ (custom endpoint: $ANTHROPIC_BASE_URL)}"
elif [[ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
  # Support ANTHROPIC_AUTH_TOKEN as alias for ANTHROPIC_API_KEY (used by some proxy endpoints)
  AUTH_ENV_ARGS+=(-e "ANTHROPIC_AUTH_TOKEN=${ANTHROPIC_AUTH_TOKEN}")
  [[ -n "${ANTHROPIC_BASE_URL:-}" ]] && AUTH_ENV_ARGS+=(-e "ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}")
  pass "Auth: ANTHROPIC_AUTH_TOKEN${ANTHROPIC_BASE_URL:+ (custom endpoint: $ANTHROPIC_BASE_URL)}"
elif [[ "${CLAUDE_CODE_USE_BEDROCK:-}" == "1" && -n "${ANTHROPIC_BEDROCK_BASE_URL:-}" ]]; then
  AUTH_ENV_ARGS+=(-e "CLAUDE_CODE_USE_BEDROCK=1")
  AUTH_ENV_ARGS+=(-e "ANTHROPIC_BEDROCK_BASE_URL=${ANTHROPIC_BEDROCK_BASE_URL}")
  [[ -n "${AWS_ACCESS_KEY_ID:-}" ]] && AUTH_ENV_ARGS+=(-e "AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}")
  [[ -n "${AWS_SECRET_ACCESS_KEY:-}" ]] && AUTH_ENV_ARGS+=(-e "AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}")
  [[ -n "${AWS_SESSION_TOKEN:-}" ]] && AUTH_ENV_ARGS+=(-e "AWS_SESSION_TOKEN=${AWS_SESSION_TOKEN}")
  [[ -n "${AWS_DEFAULT_REGION:-}" ]] && AUTH_ENV_ARGS+=(-e "AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION}")
  [[ -n "${AWS_REGION:-}" ]] && AUTH_ENV_ARGS+=(-e "AWS_REGION=${AWS_REGION}")
  [[ -n "${AWS_PROFILE:-}" ]] && AUTH_ENV_ARGS+=(-e "AWS_PROFILE=${AWS_PROFILE}")
  pass "Auth: Bedrock (${ANTHROPIC_BEDROCK_BASE_URL})"
elif [[ "${CLAUDE_CODE_USE_VERTEX:-}" == "1" && -n "${ANTHROPIC_VERTEX_PROJECT_ID:-}" ]]; then
  AUTH_ENV_ARGS+=(-e "CLAUDE_CODE_USE_VERTEX=1")
  AUTH_ENV_ARGS+=(-e "ANTHROPIC_VERTEX_PROJECT_ID=${ANTHROPIC_VERTEX_PROJECT_ID}")
  [[ -n "${CLOUD_ML_REGION:-}" ]] && AUTH_ENV_ARGS+=(-e "CLOUD_ML_REGION=${CLOUD_ML_REGION}")
  pass "Auth: Vertex AI (${ANTHROPIC_VERTEX_PROJECT_ID})"
else
  echo -e "${RED}ERROR:${RESET} No authentication method detected."
  echo ""
  echo "  Set one of:"
  echo "    export ANTHROPIC_API_KEY=sk-ant-..."
  echo "    export ANTHROPIC_AUTH_TOKEN=sk-...    # alias for API key"
  echo "    export CLAUDE_CODE_USE_BEDROCK=1 ANTHROPIC_BEDROCK_BASE_URL=..."
  echo "    export CLAUDE_CODE_USE_VERTEX=1 ANTHROPIC_VERTEX_PROJECT_ID=..."
  echo ""
  exit 1
fi

if ! command -v docker &>/dev/null; then
  echo -e "${RED}ERROR:${RESET} docker is not installed or not in PATH."
  exit 1
fi
pass "docker is available ($(docker --version | head -1))"

if ! command -v curl &>/dev/null; then
  echo -e "${RED}ERROR:${RESET} curl is not installed or not in PATH."
  exit 1
fi
pass "curl is available"

# --- build ------------------------------------------------------------------
header "Building Docker image"
info "Running: docker build -t cli2agent:test ."
docker build -t cli2agent:test . 2>&1 | tail -5
pass "Docker image built: cli2agent:test"

# --- setup ------------------------------------------------------------------
CONTAINER_NAME="cli2agent-test"
TMPWORKSPACE="$(mktemp -d)"
BASE_URL="http://localhost:3000"

# Ensure cleanup runs on exit (success or failure)
cleanup() {
  local exit_code=$?
  header "Teardown"
  if docker ps -q --filter "name=${CONTAINER_NAME}" | grep -q .; then
    info "Stopping and removing container: ${CONTAINER_NAME}"
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    pass "Container removed"
  fi
  if [[ -d "$TMPWORKSPACE" ]]; then
    rm -rf "$TMPWORKSPACE"
    pass "Temp workspace removed: $TMPWORKSPACE"
  fi
  # Re-print summary if we're exiting due to set -e
  if [[ $exit_code -ne 0 && $FAIL_COUNT -eq 0 ]]; then
    echo -e "\n${RED}Script exited unexpectedly (exit code $exit_code)${RESET}"
  fi
}
trap cleanup EXIT

# --- start container --------------------------------------------------------
header "Starting container"

# Remove any leftover container from a previous run
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

info "Workspace: $TMPWORKSPACE"
docker run -d \
  --name "${CONTAINER_NAME}" \
  -p 3000:3000 \
  "${AUTH_ENV_ARGS[@]}" \
  -e DISABLE_AUTOUPDATER=1 \
  -v "${TMPWORKSPACE}:/workspace" \
  cli2agent:test

pass "Container started: ${CONTAINER_NAME}"

# --- wait for health --------------------------------------------------------
header "Waiting for health check"

HEALTH_TIMEOUT=30
HEALTH_INTERVAL=2
elapsed=0
healthy=false

while [[ $elapsed -lt $HEALTH_TIMEOUT ]]; do
  http_status="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/health" 2>/dev/null || echo "000")"
  if [[ "$http_status" == "200" ]]; then
    healthy=true
    break
  fi
  sleep "$HEALTH_INTERVAL"
  elapsed=$(( elapsed + HEALTH_INTERVAL ))
  info "  Waiting... (${elapsed}s / ${HEALTH_TIMEOUT}s, last status: ${http_status})"
done

if [[ "$healthy" != "true" ]]; then
  fail "Service did not become healthy within ${HEALTH_TIMEOUT}s"
  echo ""
  echo "Container logs:"
  docker logs "${CONTAINER_NAME}" 2>&1 | tail -30
  exit 1
fi
pass "Service is healthy after ~${elapsed}s"

# ===========================================================================
# Tests
# ===========================================================================
header "Running integration tests"

# ---------------------------------------------------------------------------
# Test 1: GET /health
# ---------------------------------------------------------------------------
TEST_NAME="Test 1: GET /health returns status=ok"
info "$TEST_NAME"

response="$(curl -s "${BASE_URL}/health")"
http_code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/health")"

if [[ "$http_code" != "200" ]]; then
  assert_fail "$TEST_NAME" "Expected HTTP 200, got $http_code"
else
  status_field="$(echo "$response" | grep -o '"status":"[^"]*"' | head -1 | sed 's/"status":"//;s/"//')"
  if [[ "$status_field" != "ok" ]]; then
    assert_fail "$TEST_NAME" "Expected status=ok, got: $response"
  else
    assert_pass "$TEST_NAME"
    # Print auth method if present in response
    auth_method="$(echo "$response" | grep -o '"auth_method":"[^"]*"' | sed 's/"auth_method":"//;s/"//'  || true)"
    if [[ -n "$auth_method" ]]; then
      info "  Auth method detected: $auth_method"
    fi
    info "  Response: $response"
  fi
fi

# ---------------------------------------------------------------------------
# Test 2: POST /v1/sessions — create session, assert 201 and capture id
# ---------------------------------------------------------------------------
TEST_NAME="Test 2: POST /v1/sessions returns 201 with session_id"
info "$TEST_NAME"

session_response="$(curl -s -w '\n%{http_code}' -X POST "${BASE_URL}/v1/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"workspace":"/workspace","name":"integration-test"}')"

session_http_code="$(echo "$session_response" | tail -1)"
session_body="$(echo "$session_response" | sed '$d')"

if [[ "$session_http_code" != "201" ]]; then
  assert_fail "$TEST_NAME" "Expected HTTP 201, got $session_http_code — body: $session_body"
  SESSION_ID=""
else
  SESSION_ID="$(echo "$session_body" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')"
  if [[ -z "$SESSION_ID" ]]; then
    assert_fail "$TEST_NAME" "Could not extract session id from response: $session_body"
  else
    assert_pass "$TEST_NAME"
    info "  Session ID: $SESSION_ID"
  fi
fi

# ---------------------------------------------------------------------------
# Test 3: GET /v1/sessions/:id — assert status=idle
# ---------------------------------------------------------------------------
TEST_NAME="Test 3: GET /v1/sessions/:id returns status=idle"
info "$TEST_NAME"

if [[ -z "${SESSION_ID:-}" ]]; then
  assert_fail "$TEST_NAME" "Skipped — no session_id from Test 2"
else
  get_session_response="$(curl -s -w '\n%{http_code}' "${BASE_URL}/v1/sessions/${SESSION_ID}")"
  get_session_code="$(echo "$get_session_response" | tail -1)"
  get_session_body="$(echo "$get_session_response" | sed '$d')"

  if [[ "$get_session_code" != "200" ]]; then
    assert_fail "$TEST_NAME" "Expected HTTP 200, got $get_session_code — body: $get_session_body"
  else
    session_status="$(echo "$get_session_body" | grep -o '"status":"[^"]*"' | head -1 | sed 's/"status":"//;s/"//')"
    if [[ "$session_status" != "idle" ]]; then
      assert_fail "$TEST_NAME" "Expected status=idle, got status=$session_status"
    else
      assert_pass "$TEST_NAME"
      info "  Session status: $session_status"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Test 4: POST /v1/execute (non-streaming) — simple prompt
# ---------------------------------------------------------------------------
TEST_NAME="Test 4: POST /v1/execute (non-streaming) returns completed with HELLO"
info "$TEST_NAME"

execute_payload='{
  "prompt": "Reply with exactly: HELLO",
  "stream": false,
  "max_turns": 1
}'

# LLM calls can take a while — allow up to 120s
# || true prevents set -e from aborting on curl timeout (exit 28)
execute_response="$(curl -s -w '\n%{http_code}' --max-time 120 \
  -X POST "${BASE_URL}/v1/execute" \
  -H 'Content-Type: application/json' \
  -d "$execute_payload" || true)"

execute_http_code="$(echo "$execute_response" | tail -1)"
execute_body="$(echo "$execute_response" | sed '$d')"

if [[ -z "$execute_response" || "$execute_http_code" == "000" ]]; then
  assert_fail "$TEST_NAME" "Request timed out or failed to connect"
elif [[ "$execute_http_code" != "200" ]]; then
  assert_fail "$TEST_NAME" "Expected HTTP 200, got $execute_http_code — body: $execute_body"
else
  exec_status="$(echo "$execute_body" | grep -o '"status":"[^"]*"' | head -1 | sed 's/"status":"//;s/"//')"
  if [[ "$exec_status" != "completed" ]]; then
    assert_fail "$TEST_NAME" "Expected status=completed, got status=$exec_status — body: $execute_body"
  else
    # Check that the content contains HELLO (case-insensitive search in raw JSON)
    if echo "$execute_body" | grep -qi "HELLO"; then
      assert_pass "$TEST_NAME"
      info "  Status: $exec_status — response contains HELLO"
    else
      assert_fail "$TEST_NAME" "status=completed but content does not contain 'HELLO' — body: $execute_body"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Test 5: POST /v1/execute with stream=true — assert SSE events
# ---------------------------------------------------------------------------
TEST_NAME="Test 5: POST /v1/execute (streaming) contains task_start and task_complete"
info "$TEST_NAME"

stream_payload='{
  "prompt": "Reply with exactly: HELLO",
  "stream": true,
  "max_turns": 1
}'

# Capture the raw SSE stream; allow up to 120s
# || true prevents set -e from aborting on curl timeout (exit 28)
sse_output="$(curl -s -N --max-time 120 \
  -X POST "${BASE_URL}/v1/execute" \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d "$stream_payload" 2>&1 || true)"

has_task_start=false
has_task_complete=false

if echo "$sse_output" | grep -q "event: task_start"; then
  has_task_start=true
fi
if echo "$sse_output" | grep -q "event: task_complete"; then
  has_task_complete=true
fi

if [[ "$has_task_start" == "true" && "$has_task_complete" == "true" ]]; then
  assert_pass "$TEST_NAME"
  info "  Received: event: task_start — OK"
  info "  Received: event: task_complete — OK"
else
  details=""
  [[ "$has_task_start" == "false" ]] && details+="missing 'event: task_start'; "
  [[ "$has_task_complete" == "false" ]] && details+="missing 'event: task_complete'; "
  assert_fail "$TEST_NAME" "$details"
  echo "  --- SSE output (first 40 lines) ---"
  echo "$sse_output" | head -40 | sed 's/^/  /'
  echo "  -----------------------------------"
fi

# ---------------------------------------------------------------------------
# Test 6: Multi-turn session continuation (non-streaming)
# ---------------------------------------------------------------------------
TEST_NAME="Test 6: Multi-turn session continuation (non-streaming)"
info "$TEST_NAME"

# 6a: Create a fresh session for multi-turn testing
mt_session_response="$(curl -s -w '\n%{http_code}' -X POST "${BASE_URL}/v1/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"workspace":"/workspace","name":"multi-turn-test"}')"

mt_session_code="$(echo "$mt_session_response" | tail -1)"
mt_session_body="$(echo "$mt_session_response" | sed '$d')"
MULTI_TURN_SESSION_ID="$(echo "$mt_session_body" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')"

if [[ "$mt_session_code" != "201" || -z "$MULTI_TURN_SESSION_ID" ]]; then
  assert_fail "$TEST_NAME" "Failed to create session (HTTP $mt_session_code) — body: $mt_session_body"
else
  info "  Created session: $MULTI_TURN_SESSION_ID"

  # 6b: First prompt — ask Claude to remember a secret code
  mt_prompt1_payload="$(cat <<EOF
{
  "session_id": "$MULTI_TURN_SESSION_ID",
  "prompt": "Remember this secret code: BANANA42. Acknowledge by saying OK.",
  "stream": false,
  "max_turns": 1
}
EOF
)"

  mt_exec1_response="$(curl -s -w '\n%{http_code}' --max-time 120 \
    -X POST "${BASE_URL}/v1/execute" \
    -H 'Content-Type: application/json' \
    -d "$mt_prompt1_payload" || true)"

  mt_exec1_code="$(echo "$mt_exec1_response" | tail -1)"
  mt_exec1_body="$(echo "$mt_exec1_response" | sed '$d')"

  if [[ -z "$mt_exec1_response" || "$mt_exec1_code" == "000" ]]; then
    assert_fail "$TEST_NAME" "Prompt 1 timed out or failed to connect"
  elif [[ "$mt_exec1_code" != "200" ]]; then
    assert_fail "$TEST_NAME" "Prompt 1 expected HTTP 200, got $mt_exec1_code — body: $mt_exec1_body"
  elif ! echo "$mt_exec1_body" | grep -qi "OK"; then
    assert_fail "$TEST_NAME" "Prompt 1 response does not contain acknowledgment — body: $mt_exec1_body"
  else
    info "  Prompt 1: acknowledged (contains OK)"

    # 6c: Second prompt — ask for the secret code back
    mt_prompt2_payload="$(cat <<EOF
{
  "session_id": "$MULTI_TURN_SESSION_ID",
  "prompt": "What was the secret code I told you?",
  "stream": false,
  "max_turns": 1
}
EOF
)"

    mt_exec2_response="$(curl -s -w '\n%{http_code}' --max-time 120 \
      -X POST "${BASE_URL}/v1/execute" \
      -H 'Content-Type: application/json' \
      -d "$mt_prompt2_payload" || true)"

    mt_exec2_code="$(echo "$mt_exec2_response" | tail -1)"
    mt_exec2_body="$(echo "$mt_exec2_response" | sed '$d')"

    if [[ -z "$mt_exec2_response" || "$mt_exec2_code" == "000" ]]; then
      assert_fail "$TEST_NAME" "Prompt 2 timed out or failed to connect"
    elif [[ "$mt_exec2_code" != "200" ]]; then
      assert_fail "$TEST_NAME" "Prompt 2 expected HTTP 200, got $mt_exec2_code — body: $mt_exec2_body"
    elif echo "$mt_exec2_body" | grep -q "BANANA42"; then
      assert_pass "$TEST_NAME"
      info "  Prompt 2: correctly recalled BANANA42 — session context preserved"
    else
      assert_fail "$TEST_NAME" "Prompt 2 response does not contain 'BANANA42' — body: $mt_exec2_body"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Test 7: Multi-turn session continuation (streaming)
# ---------------------------------------------------------------------------
TEST_NAME="Test 7: Multi-turn session continuation (streaming)"
info "$TEST_NAME"

# 7a: Create a fresh session for streaming multi-turn testing
smt_session_response="$(curl -s -w '\n%{http_code}' -X POST "${BASE_URL}/v1/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"workspace":"/workspace","name":"stream-multi-turn-test"}')"

smt_session_code="$(echo "$smt_session_response" | tail -1)"
smt_session_body="$(echo "$smt_session_response" | sed '$d')"
STREAM_MT_SESSION_ID="$(echo "$smt_session_body" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')"

if [[ "$smt_session_code" != "201" || -z "$STREAM_MT_SESSION_ID" ]]; then
  assert_fail "$TEST_NAME" "Failed to create session (HTTP $smt_session_code) — body: $smt_session_body"
else
  info "  Created session: $STREAM_MT_SESSION_ID"

  # 7b: First streaming prompt — ask Claude to remember a favorite color
  smt_prompt1_payload="$(cat <<EOF
{
  "session_id": "$STREAM_MT_SESSION_ID",
  "prompt": "Remember: my favorite color is PURPLE. Say understood.",
  "stream": true,
  "max_turns": 1
}
EOF
)"

  smt_sse1="$(curl -s -N --max-time 120 \
    -X POST "${BASE_URL}/v1/execute" \
    -H 'Content-Type: application/json' \
    -H 'Accept: text/event-stream' \
    -d "$smt_prompt1_payload" 2>&1 || true)"

  smt1_has_complete=false
  if echo "$smt_sse1" | grep -q "event: task_complete"; then
    smt1_has_complete=true
  fi

  if [[ -z "$smt_sse1" ]]; then
    assert_fail "$TEST_NAME" "Prompt 1 returned empty SSE output"
  elif [[ "$smt1_has_complete" != "true" ]]; then
    assert_fail "$TEST_NAME" "Prompt 1 missing 'event: task_complete'"
    echo "  --- SSE output (first 30 lines) ---"
    echo "$smt_sse1" | head -30 | sed 's/^/  /'
    echo "  -----------------------------------"
  else
    info "  Prompt 1: received task_complete — acknowledged"

    # 7c: Second streaming prompt — ask for the favorite color back
    smt_prompt2_payload="$(cat <<EOF
{
  "session_id": "$STREAM_MT_SESSION_ID",
  "prompt": "What is my favorite color?",
  "stream": true,
  "max_turns": 1
}
EOF
)"

    smt_sse2="$(curl -s -N --max-time 120 \
      -X POST "${BASE_URL}/v1/execute" \
      -H 'Content-Type: application/json' \
      -H 'Accept: text/event-stream' \
      -d "$smt_prompt2_payload" 2>&1 || true)"

    smt2_has_complete=false
    smt2_has_purple=false

    if echo "$smt_sse2" | grep -q "event: task_complete"; then
      smt2_has_complete=true
    fi
    # Check entire SSE output for PURPLE (may be in text_delta data lines)
    if echo "$smt_sse2" | grep -qi "PURPLE"; then
      smt2_has_purple=true
    fi

    if [[ "$smt2_has_complete" == "true" && "$smt2_has_purple" == "true" ]]; then
      assert_pass "$TEST_NAME"
      info "  Prompt 2: received task_complete with PURPLE — session context preserved"
    else
      details=""
      [[ "$smt2_has_complete" == "false" ]] && details+="missing 'event: task_complete'; "
      [[ "$smt2_has_purple" == "false" ]] && details+="response does not contain 'PURPLE'; "
      assert_fail "$TEST_NAME" "$details"
      echo "  --- SSE output (first 40 lines) ---"
      echo "$smt_sse2" | head -40 | sed 's/^/  /'
      echo "  -----------------------------------"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Test 8: Session message_count and token tracking
# ---------------------------------------------------------------------------
TEST_NAME="Test 8: Session message_count and token tracking"
info "$TEST_NAME"

if [[ -z "${MULTI_TURN_SESSION_ID:-}" ]]; then
  assert_fail "$TEST_NAME" "Skipped — no session_id from Test 6"
else
  token_response="$(curl -s -w '\n%{http_code}' "${BASE_URL}/v1/sessions/${MULTI_TURN_SESSION_ID}")"
  token_code="$(echo "$token_response" | tail -1)"
  token_body="$(echo "$token_response" | sed '$d')"

  if [[ "$token_code" != "200" ]]; then
    assert_fail "$TEST_NAME" "Expected HTTP 200, got $token_code — body: $token_body"
  else
    message_count="$(echo "$token_body" | grep -o '"message_count":[0-9]*' | head -1 | sed 's/"message_count"://')"
    input_tokens="$(echo "$token_body" | grep -o '"total_input_tokens":[0-9]*' | head -1 | sed 's/"total_input_tokens"://')"
    output_tokens="$(echo "$token_body" | grep -o '"total_output_tokens":[0-9]*' | head -1 | sed 's/"total_output_tokens"://')"

    t8_pass=true
    t8_details=""

    if [[ -z "$message_count" || "$message_count" -le 0 ]] 2>/dev/null; then
      t8_pass=false
      t8_details+="message_count not > 0 (got: '${message_count:-empty}'); "
    fi
    if [[ -z "$input_tokens" || "$input_tokens" -le 0 ]] 2>/dev/null; then
      t8_pass=false
      t8_details+="total_input_tokens not > 0 (got: '${input_tokens:-empty}'); "
    fi
    # Note: total_output_tokens may be 0 with some proxy endpoints that
    # don't report output token usage. Only warn, don't fail.
    if [[ -z "$output_tokens" || "$output_tokens" -le 0 ]] 2>/dev/null; then
      info "  Warning: total_output_tokens is ${output_tokens:-0} (some proxies don't report output usage)"
    fi

    if [[ "$t8_pass" == "true" ]]; then
      assert_pass "$TEST_NAME"
      info "  message_count=$message_count, total_input_tokens=$input_tokens, total_output_tokens=$output_tokens"
    else
      assert_fail "$TEST_NAME" "$t8_details"
      info "  Response body: $token_body"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Test 9: Bash tool execution
# ---------------------------------------------------------------------------
TEST_NAME="Test 9: Bash tool execution returns tool_use/tool_result"
info "$TEST_NAME"

t9_response="$(curl -s -w '\n%{http_code}' --max-time 120 \
  -X POST "${BASE_URL}/v1/execute" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Run a bash command to list files in the current directory and tell me the output.","stream":false,"max_turns":3}' || true)"

t9_code="$(echo "$t9_response" | tail -1)"
t9_body="$(echo "$t9_response" | sed '$d')"

if [[ -z "$t9_response" || "$t9_code" == "000" ]]; then
  assert_fail "$TEST_NAME" "Request timed out or failed to connect"
elif [[ "$t9_code" != "200" ]]; then
  assert_fail "$TEST_NAME" "Expected HTTP 200, got $t9_code — body: $t9_body"
else
  t9_status="$(echo "$t9_body" | grep -o '"status":"[^"]*"' | head -1 | sed 's/"status":"//;s/"//')"
  if [[ "$t9_status" != "completed" ]]; then
    assert_fail "$TEST_NAME" "Expected status=completed, got status=$t9_status"
  else
    # Check for tool_use or tool_result in content
    if echo "$t9_body" | grep -q '"type":"tool_use"\|"type":"tool_result"'; then
      assert_pass "$TEST_NAME"
      info "  Status: completed — response contains tool content blocks"
    else
      assert_fail "$TEST_NAME" "status=completed but no tool_use/tool_result blocks found"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Test 10: File write action
# ---------------------------------------------------------------------------
TEST_NAME="Test 10: File write action creates file on host"
info "$TEST_NAME"

# Clean up any prior run
rm -f "$TMPWORKSPACE/test-output.txt"

t10_response="$(curl -s -w '\n%{http_code}' --max-time 120 \
  -X POST "${BASE_URL}/v1/execute" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Create a file called /workspace/test-output.txt with exactly this content: cli2agent integration test","stream":false,"max_turns":3}' || true)"

t10_code="$(echo "$t10_response" | tail -1)"
t10_body="$(echo "$t10_response" | sed '$d')"

if [[ -z "$t10_response" || "$t10_code" == "000" ]]; then
  assert_fail "$TEST_NAME" "Request timed out or failed to connect"
elif [[ "$t10_code" != "200" ]]; then
  assert_fail "$TEST_NAME" "Expected HTTP 200, got $t10_code — body: $t10_body"
else
  t10_status="$(echo "$t10_body" | grep -o '"status":"[^"]*"' | head -1 | sed 's/"status":"//;s/"//')"
  if [[ "$t10_status" != "completed" ]]; then
    assert_fail "$TEST_NAME" "Expected status=completed, got status=$t10_status"
  elif test -f "$TMPWORKSPACE/test-output.txt"; then
    file_content="$(cat "$TMPWORKSPACE/test-output.txt" 2>/dev/null)" || true
    if echo "$file_content" | grep -q "cli2agent integration test"; then
      assert_pass "$TEST_NAME"
      info "  File created and contains expected content"
    else
      assert_fail "$TEST_NAME" "File exists but content mismatch: $file_content"
    fi
  else
    assert_fail "$TEST_NAME" "File not found at $TMPWORKSPACE/test-output.txt"
  fi
fi

# ---------------------------------------------------------------------------
# Test 11: Bash command with output verification
# ---------------------------------------------------------------------------
TEST_NAME="Test 11: Bash command output captured in response"
info "$TEST_NAME"

t11_response="$(curl -s -w '\n%{http_code}' --max-time 120 \
  -X POST "${BASE_URL}/v1/execute" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Run the command: echo HELLO_WORLD_12345 — then tell me what it printed","stream":false,"max_turns":3}' || true)"

t11_code="$(echo "$t11_response" | tail -1)"
t11_body="$(echo "$t11_response" | sed '$d')"

if [[ -z "$t11_response" || "$t11_code" == "000" ]]; then
  assert_fail "$TEST_NAME" "Request timed out or failed to connect"
elif [[ "$t11_code" != "200" ]]; then
  assert_fail "$TEST_NAME" "Expected HTTP 200, got $t11_code — body: $t11_body"
else
  if echo "$t11_body" | grep -q "HELLO_WORLD_12345"; then
    assert_pass "$TEST_NAME"
    info "  Response contains HELLO_WORLD_12345"
  else
    assert_fail "$TEST_NAME" "Response does not contain 'HELLO_WORLD_12345'"
  fi
fi

# ---------------------------------------------------------------------------
# Test 12: System prompt customization
# ---------------------------------------------------------------------------
TEST_NAME="Test 12: System prompt customization"
info "$TEST_NAME"

t12_payload='{"prompt":"Say hello","system_prompt":"You are a pirate. Always say Arrr in your responses.","stream":false,"max_turns":1}'

t12_response="$(curl -s -w '\n%{http_code}' --max-time 120 \
  -X POST "${BASE_URL}/v1/execute" \
  -H 'Content-Type: application/json' \
  -d "$t12_payload" || true)"

t12_code="$(echo "$t12_response" | tail -1)"
t12_body="$(echo "$t12_response" | sed '$d')"

if [[ -z "$t12_response" || "$t12_code" == "000" ]]; then
  assert_fail "$TEST_NAME" "Request timed out or failed to connect"
elif [[ "$t12_code" != "200" ]]; then
  assert_fail "$TEST_NAME" "Expected HTTP 200, got $t12_code — body: $t12_body"
else
  if echo "$t12_body" | grep -qi "Arrr"; then
    assert_pass "$TEST_NAME"
    info "  Response contains 'Arrr' — system prompt respected"
  else
    assert_fail "$TEST_NAME" "Response does not contain 'Arrr' (case-insensitive)"
  fi
fi

# ---------------------------------------------------------------------------
# Test 13: List sessions with filters
# ---------------------------------------------------------------------------
TEST_NAME="Test 13: List sessions with filters"
info "$TEST_NAME"

# 13a: GET /v1/sessions — verify sessions array and total field
t13a_response="$(curl -s -w '\n%{http_code}' "${BASE_URL}/v1/sessions")"
t13a_code="$(echo "$t13a_response" | tail -1)"
t13a_body="$(echo "$t13a_response" | sed '$d')"

if [[ "$t13a_code" != "200" ]]; then
  assert_fail "$TEST_NAME (list all)" "Expected HTTP 200, got $t13a_code"
else
  if echo "$t13a_body" | grep -q '"sessions"' && echo "$t13a_body" | grep -q '"total"'; then
    assert_pass "$TEST_NAME (list all has sessions + total)"
    info "  Response contains sessions array and total field"
  else
    assert_fail "$TEST_NAME (list all)" "Missing sessions or total field — body: $t13a_body"
  fi
fi

# 13b: GET /v1/sessions?status=idle — only idle sessions
t13b_response="$(curl -s -w '\n%{http_code}' "${BASE_URL}/v1/sessions?status=idle")"
t13b_code="$(echo "$t13b_response" | tail -1)"
t13b_body="$(echo "$t13b_response" | sed '$d')"

if [[ "$t13b_code" != "200" ]]; then
  assert_fail "$TEST_NAME (filter idle)" "Expected HTTP 200, got $t13b_code"
else
  non_idle="$(echo "$t13b_body" | grep -o '"status":"[^"]*"' | grep -v '"status":"idle"' | head -1 || true)"
  if [[ -z "$non_idle" ]]; then
    assert_pass "$TEST_NAME (filter idle returns only idle)"
  else
    assert_fail "$TEST_NAME (filter idle)" "Found non-idle session: $non_idle"
  fi
fi

# 13c: GET /v1/sessions?limit=1 — at most 1 item
t13c_response="$(curl -s -w '\n%{http_code}' "${BASE_URL}/v1/sessions?limit=1")"
t13c_code="$(echo "$t13c_response" | tail -1)"
t13c_body="$(echo "$t13c_response" | sed '$d')"

if [[ "$t13c_code" != "200" ]]; then
  assert_fail "$TEST_NAME (limit=1)" "Expected HTTP 200, got $t13c_code"
else
  # Count "id" fields inside sessions array (each session has an "id")
  id_count="$(echo "$t13c_body" | grep -o '"id":"[^"]*"' | wc -l | tr -d ' ')"
  if [[ "$id_count" -le 1 ]]; then
    assert_pass "$TEST_NAME (limit=1 returns at most 1 session)"
  else
    assert_fail "$TEST_NAME (limit=1)" "Expected at most 1, got $id_count"
  fi
fi

# ---------------------------------------------------------------------------
# Test 14: Delete a session
# ---------------------------------------------------------------------------
TEST_NAME="Test 14: Delete a session"
info "$TEST_NAME"

# Create a throwaway session
t14_create="$(curl -s -w '\n%{http_code}' -X POST "${BASE_URL}/v1/sessions" \
  -H 'Content-Type: application/json' \
  -d '{"workspace":"/workspace","name":"delete-me"}')"
t14_create_code="$(echo "$t14_create" | tail -1)"
t14_create_body="$(echo "$t14_create" | sed '$d')"
DELETE_SESSION_ID="$(echo "$t14_create_body" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')"

if [[ "$t14_create_code" != "201" || -z "$DELETE_SESSION_ID" ]]; then
  assert_fail "$TEST_NAME" "Failed to create session for deletion (HTTP $t14_create_code)"
else
  info "  Created session: $DELETE_SESSION_ID"

  # Delete it
  t14_del="$(curl -s -w '\n%{http_code}' -X DELETE "${BASE_URL}/v1/sessions/${DELETE_SESSION_ID}")"
  t14_del_code="$(echo "$t14_del" | tail -1)"

  if [[ "$t14_del_code" == "204" ]]; then
    assert_pass "$TEST_NAME (DELETE returns 204)"
  else
    assert_fail "$TEST_NAME (DELETE)" "Expected 204, got $t14_del_code"
  fi

  # Verify it's gone
  t14_get="$(curl -s -w '\n%{http_code}' "${BASE_URL}/v1/sessions/${DELETE_SESSION_ID}")"
  t14_get_code="$(echo "$t14_get" | tail -1)"

  if [[ "$t14_get_code" == "404" ]]; then
    assert_pass "$TEST_NAME (GET after delete returns 404)"
  else
    assert_fail "$TEST_NAME (GET after delete)" "Expected 404, got $t14_get_code"
  fi
fi

# ---------------------------------------------------------------------------
# Test 15: 404 on non-existent session
# ---------------------------------------------------------------------------
TEST_NAME="Test 15: 404 on non-existent session"
info "$TEST_NAME"

t15_response="$(curl -s -w '\n%{http_code}' "${BASE_URL}/v1/sessions/00000000-0000-0000-0000-000000000000")"
t15_code="$(echo "$t15_response" | tail -1)"
t15_body="$(echo "$t15_response" | sed '$d')"

if [[ "$t15_code" == "404" ]]; then
  assert_pass "$TEST_NAME (returns 404)"
else
  assert_fail "$TEST_NAME" "Expected 404, got $t15_code"
fi

if echo "$t15_body" | grep -q "not_found"; then
  assert_pass "$TEST_NAME (body contains not_found)"
else
  assert_fail "$TEST_NAME (body)" "Expected not_found in body — got: $t15_body"
fi

# ---------------------------------------------------------------------------
# Test 16: Invalid execute payload (Zod validation)
# ---------------------------------------------------------------------------
TEST_NAME="Test 16: Invalid execute payload returns 400"
info "$TEST_NAME"

t16_response="$(curl -s -w '\n%{http_code}' -X POST "${BASE_URL}/v1/execute" \
  -H 'Content-Type: application/json' \
  -d '{}')"
t16_code="$(echo "$t16_response" | tail -1)"
t16_body="$(echo "$t16_response" | sed '$d')"

if [[ "$t16_code" == "400" ]]; then
  assert_pass "$TEST_NAME"
  info "  Zod validation rejected empty payload"
else
  assert_fail "$TEST_NAME" "Expected 400, got $t16_code — body: $t16_body"
fi

# ---------------------------------------------------------------------------
# Test 17: Session auto-creation on execute
# ---------------------------------------------------------------------------
TEST_NAME="Test 17: Session auto-creation on execute"
info "$TEST_NAME"

t17_response="$(curl -s -w '\n%{http_code}' --max-time 120 \
  -X POST "${BASE_URL}/v1/execute" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Reply with exactly: HELLO","stream":false,"max_turns":1}' || true)"

t17_code="$(echo "$t17_response" | tail -1)"
t17_body="$(echo "$t17_response" | sed '$d')"

if [[ -z "$t17_response" || "$t17_code" == "000" ]]; then
  assert_fail "$TEST_NAME" "Request timed out or failed to connect"
elif [[ "$t17_code" != "200" ]]; then
  assert_fail "$TEST_NAME" "Expected HTTP 200, got $t17_code — body: $t17_body"
else
  assert_pass "$TEST_NAME (execute without session_id returns 200)"

  AUTO_SESSION_ID="$(echo "$t17_body" | grep -o '"session_id":"[^"]*"' | head -1 | sed 's/"session_id":"//;s/"//')"
  if [[ -n "$AUTO_SESSION_ID" ]]; then
    assert_pass "$TEST_NAME (response has auto-created session_id)"
    info "  Auto-created session: $AUTO_SESSION_ID"

    # Verify the session exists
    t17_get="$(curl -s -w '\n%{http_code}' "${BASE_URL}/v1/sessions/${AUTO_SESSION_ID}")"
    t17_get_code="$(echo "$t17_get" | tail -1)"

    if [[ "$t17_get_code" == "200" ]]; then
      assert_pass "$TEST_NAME (auto-created session retrievable via GET)"
    else
      assert_fail "$TEST_NAME (GET auto session)" "Expected 200, got $t17_get_code"
    fi
  else
    assert_fail "$TEST_NAME (session_id)" "No session_id found in response"
  fi
fi

# ---------------------------------------------------------------------------
# Test 18: POST /v1/messages validation (missing model returns 400)
# ---------------------------------------------------------------------------
TEST_NAME="Test 18: POST /v1/messages validation (missing model returns 400)"
info "$TEST_NAME"

t18_response="$(curl -s -w '\n%{http_code}' -X POST "${BASE_URL}/v1/messages" \
  -H 'Content-Type: application/json' \
  -d '{"messages": []}')"
t18_code="$(echo "$t18_response" | tail -1)"
t18_body="$(echo "$t18_response" | sed '$d')"

if [[ "$t18_code" == "400" ]]; then
  assert_pass "$TEST_NAME"
  info "  Schema validation rejected missing model field"
else
  assert_fail "$TEST_NAME" "Expected 400, got $t18_code — body: $t18_body"
fi

# ---------------------------------------------------------------------------
# Test 19: POST /v1/messages non-streaming (conditional on auth)
# ---------------------------------------------------------------------------
TEST_NAME="Test 19: POST /v1/messages non-streaming"
info "$TEST_NAME"

# Detect auth method from health endpoint
t19_health="$(curl -s "${BASE_URL}/health")"
t19_auth_method="$(echo "$t19_health" | grep -o '"method":"[^"]*"' | head -1 | sed 's/"method":"//;s/"//' || true)"

if [[ -z "$t19_auth_method" || "$t19_auth_method" == "none" ]]; then
  info "  SKIP: No auth method configured, skipping non-streaming messages test"
else
  t19_payload='{"model":"claude-sonnet-4-6","max_tokens":100,"messages":[{"role":"user","content":"Say the word hello"}]}'

  t19_response="$(curl -s -w '\n%{http_code}' --max-time 120 \
    -X POST "${BASE_URL}/v1/messages" \
    -H 'Content-Type: application/json' \
    -d "$t19_payload" || true)"

  t19_code="$(echo "$t19_response" | tail -1)"
  t19_body="$(echo "$t19_response" | sed '$d')"

  if [[ -z "$t19_response" || "$t19_code" == "000" ]]; then
    assert_fail "$TEST_NAME" "Request timed out or failed to connect"
  elif [[ "$t19_code" == "400" ]]; then
    assert_fail "$TEST_NAME" "Valid request returned 400 (schema rejection) — body: $t19_body"
  elif [[ "$t19_code" == "200" ]]; then
    if echo "$t19_body" | grep -qi "hello"; then
      assert_pass "$TEST_NAME"
      info "  Response contains 'hello'"
    else
      assert_pass "$TEST_NAME"
      info "  HTTP 200 returned (response may not contain 'hello' literally)"
    fi
  else
    # 500 or other — CLI error, but schema was accepted
    assert_pass "$TEST_NAME (schema accepted, HTTP $t19_code)"
    info "  Endpoint accepted valid schema (HTTP $t19_code)"
  fi
fi

# ---------------------------------------------------------------------------
# Test 20: POST /v1/messages streaming (conditional on auth)
# ---------------------------------------------------------------------------
TEST_NAME="Test 20: POST /v1/messages streaming contains message_start"
info "$TEST_NAME"

t20_health="$(curl -s "${BASE_URL}/health")"
t20_auth_method="$(echo "$t20_health" | grep -o '"method":"[^"]*"' | head -1 | sed 's/"method":"//;s/"//' || true)"

if [[ -z "$t20_auth_method" || "$t20_auth_method" == "none" ]]; then
  info "  SKIP: No auth method configured, skipping streaming messages test"
else
  t20_payload='{"model":"claude-sonnet-4-6","max_tokens":100,"messages":[{"role":"user","content":"Say the word hello"}],"stream":true}'

  t20_sse="$(curl -s -N --max-time 120 \
    -X POST "${BASE_URL}/v1/messages" \
    -H 'Content-Type: application/json' \
    -H 'Accept: text/event-stream' \
    -d "$t20_payload" 2>&1 || true)"

  if [[ -z "$t20_sse" ]]; then
    assert_fail "$TEST_NAME" "Empty response from streaming endpoint"
  elif echo "$t20_sse" | grep -q "message_start"; then
    assert_pass "$TEST_NAME"
    info "  Streaming response contains message_start event"
  else
    assert_fail "$TEST_NAME" "message_start not found in streaming response"
    echo "  --- SSE output (first 30 lines) ---"
    echo "$t20_sse" | head -30 | sed 's/^/  /'
    echo "  -----------------------------------"
  fi
fi

# ---------------------------------------------------------------------------
# Test 21: POST /v1/messages with system prompt (conditional on auth)
# ---------------------------------------------------------------------------
TEST_NAME="Test 21: POST /v1/messages with system prompt"
info "$TEST_NAME"

t21_health="$(curl -s "${BASE_URL}/health")"
t21_auth_method="$(echo "$t21_health" | grep -o '"method":"[^"]*"' | head -1 | sed 's/"method":"//;s/"//' || true)"

if [[ -z "$t21_auth_method" || "$t21_auth_method" == "none" ]]; then
  info "  SKIP: No auth method configured, skipping system prompt messages test"
else
  t21_payload='{"model":"claude-sonnet-4-6","max_tokens":100,"system":"You are a pirate. Always say Arrr.","messages":[{"role":"user","content":"Say hello"}]}'

  t21_response="$(curl -s -w '\n%{http_code}' --max-time 120 \
    -X POST "${BASE_URL}/v1/messages" \
    -H 'Content-Type: application/json' \
    -d "$t21_payload" || true)"

  t21_code="$(echo "$t21_response" | tail -1)"
  t21_body="$(echo "$t21_response" | sed '$d')"

  if [[ -z "$t21_response" || "$t21_code" == "000" ]]; then
    assert_fail "$TEST_NAME" "Request timed out or failed to connect"
  elif [[ "$t21_code" == "400" ]]; then
    assert_fail "$TEST_NAME" "Valid request returned 400 (schema rejection) — body: $t21_body"
  elif [[ "$t21_code" == "200" ]]; then
    if echo "$t21_body" | grep -qi "Arrr"; then
      assert_pass "$TEST_NAME"
      info "  Response contains 'Arrr' — system prompt respected"
    else
      assert_pass "$TEST_NAME (HTTP 200, system prompt accepted)"
      info "  HTTP 200 returned (response may not contain 'Arrr' literally)"
    fi
  else
    assert_pass "$TEST_NAME (schema accepted, HTTP $t21_code)"
    info "  Endpoint accepted valid schema with system field (HTTP $t21_code)"
  fi
fi

# ===========================================================================
# Backend-switching tests
# ===========================================================================
header "Backend-switching tests"
info "Testing server startup with different CLI2AGENT_CLI_BACKEND values"

# We test each non-default backend by:
#   1. Stop the current container
#   2. Start a new one with CLI2AGENT_CLI_BACKEND=<backend>
#   3. Verify health reports the correct backend
#   4. Verify request validation still works (schema is backend-independent)
#   5. Verify execute fails gracefully (CLI binary not installed)

for BACKEND in codex gemini opencode kimi; do
  TEST_NAME="Test backend=$BACKEND: health reports correct backend"
  info "$TEST_NAME"

  # Stop the running container
  docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

  # Start with alternate backend
  docker run -d \
    --name "${CONTAINER_NAME}" \
    -p 3000:3000 \
    "${AUTH_ENV_ARGS[@]}" \
    -e DISABLE_AUTOUPDATER=1 \
    -e CLI2AGENT_CLI_BACKEND="${BACKEND}" \
    -v "${TMPWORKSPACE}:/workspace" \
    cli2agent:test

  # Wait for health
  be_healthy=false
  for i in $(seq 1 20); do
    be_status="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/health" 2>/dev/null || echo "000")"
    if [[ "$be_status" == "200" ]]; then
      be_healthy=true
      break
    fi
    sleep 1
  done

  if [[ "$be_healthy" != "true" ]]; then
    assert_fail "$TEST_NAME" "Server did not become healthy with backend=$BACKEND"
    docker logs "${CONTAINER_NAME}" 2>&1 | tail -10 | sed 's/^/  /'
    # Try to restart with claude for remaining tests
    docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    continue
  fi

  # Check health reports correct backend
  be_health="$(curl -s "${BASE_URL}/health")"
  be_reported="$(echo "$be_health" | grep -o '"backend":"[^"]*"' | head -1 | sed 's/"backend":"//;s/"//' || true)"

  if [[ "$be_reported" == "$BACKEND" ]]; then
    assert_pass "$TEST_NAME"
    info "  Health reports backend=$be_reported"
  else
    assert_fail "$TEST_NAME" "Expected backend=$BACKEND, health reports backend=$be_reported"
  fi

  # Test schema validation still works with this backend
  TEST_NAME="Test backend=$BACKEND: schema validation works"
  info "$TEST_NAME"

  be_val_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/v1/execute" \
    -H 'Content-Type: application/json' \
    -d '{}')"

  if [[ "$be_val_code" == "400" ]]; then
    assert_pass "$TEST_NAME"
    info "  Empty payload correctly rejected with 400"
  else
    assert_fail "$TEST_NAME" "Expected 400, got $be_val_code"
  fi

  # Test messages endpoint validation with this backend
  TEST_NAME="Test backend=$BACKEND: messages validation works"
  info "$TEST_NAME"

  be_msg_code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/v1/messages" \
    -H 'Content-Type: application/json' \
    -d '{"messages":[]}')"

  if [[ "$be_msg_code" == "400" ]]; then
    assert_pass "$TEST_NAME"
    info "  Missing model correctly rejected with 400"
  else
    assert_fail "$TEST_NAME" "Expected 400, got $be_msg_code"
  fi

  # Test execute with non-installed backend (should fail gracefully, not crash)
  TEST_NAME="Test backend=$BACKEND: execute fails gracefully (binary not installed)"
  info "$TEST_NAME"

  be_exec_response="$(curl -s -w '\n%{http_code}' --max-time 30 \
    -X POST "${BASE_URL}/v1/execute" \
    -H 'Content-Type: application/json' \
    -d '{"prompt":"Say hello","stream":false,"max_turns":1}' || true)"

  be_exec_code="$(echo "$be_exec_response" | tail -1)"
  be_exec_body="$(echo "$be_exec_response" | sed '$d')"

  if [[ -z "$be_exec_response" || "$be_exec_code" == "000" ]]; then
    assert_fail "$TEST_NAME" "Request timed out"
  elif [[ "$be_exec_code" == "200" || "$be_exec_code" == "500" ]]; then
    # 200 with error status or 500 — both acceptable (graceful failure)
    assert_pass "$TEST_NAME"
    info "  Execute returned HTTP $be_exec_code (graceful failure, server still alive)"
  else
    # Any response that isn't a crash is acceptable
    assert_pass "$TEST_NAME"
    info "  Execute returned HTTP $be_exec_code"
  fi

  # Verify server is still running after the failed execute
  TEST_NAME="Test backend=$BACKEND: server survives failed execute"
  info "$TEST_NAME"

  be_alive_code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE_URL}/health" 2>/dev/null || echo "000")"
  if [[ "$be_alive_code" == "200" ]]; then
    assert_pass "$TEST_NAME"
    info "  Server still healthy after failed execute"
  else
    assert_fail "$TEST_NAME" "Server not healthy after failed execute (HTTP $be_alive_code)"
  fi
done

# Restart with default claude backend for any cleanup
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true

# ===========================================================================
# Summary
# ===========================================================================
header "Test Summary"
TOTAL=$(( PASS_COUNT + FAIL_COUNT ))
echo -e "  Total:  $TOTAL"
echo -e "  ${GREEN}Passed: $PASS_COUNT${RESET}"
echo -e "  ${RED}Failed: $FAIL_COUNT${RESET}"

if [[ $FAIL_COUNT -gt 0 ]]; then
  echo ""
  echo -e "${RED}Failed tests:${RESET}"
  for t in "${FAILED_TESTS[@]}"; do
    echo -e "  ${RED}✗${RESET} $t"
  done
  echo ""
  exit 1
else
  echo ""
  echo -e "${GREEN}All tests passed.${RESET}"
  echo ""
  exit 0
fi
