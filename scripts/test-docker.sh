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
