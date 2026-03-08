#!/usr/bin/env bash
# Test script for POST /v1/messages (Anthropic Messages API compatible endpoint)
# Usage: ./scripts/test-messages.sh [base_url]

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
ENDPOINT="${BASE_URL}/v1/messages"

echo "========================================="
echo " Testing POST /v1/messages"
echo " Base URL: ${BASE_URL}"
echo "========================================="
echo

# ─── Test 1: Non-streaming ───────────────────────────────────────────────────
echo "--- Test 1: Non-streaming request ---"
echo
curl -s -X POST "${ENDPOINT}" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 100,
    "messages": [
      {"role": "user", "content": "Say hello in exactly 5 words"}
    ]
  }' | jq .
echo
echo

# ─── Test 2: Streaming ──────────────────────────────────────────────────────
echo "--- Test 2: Streaming request ---"
echo
curl -s -N -X POST "${ENDPOINT}" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 100,
    "stream": true,
    "messages": [
      {"role": "user", "content": "Say hello in exactly 5 words"}
    ]
  }' &
STREAM_PID=$!

# Let the stream run for a bit then kill it
sleep 15 && kill $STREAM_PID 2>/dev/null || true
wait $STREAM_PID 2>/dev/null || true
echo
echo

# ─── Test 3: With system prompt ──────────────────────────────────────────────
echo "--- Test 3: With system prompt ---"
echo
curl -s -X POST "${ENDPOINT}" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 100,
    "system": "You are a pirate. Always respond in pirate speak.",
    "messages": [
      {"role": "user", "content": "Say hello in exactly 5 words"}
    ]
  }' | jq .
echo
echo

# ─── Test 4: With thinking enabled ──────────────────────────────────────────
echo "--- Test 4: With thinking enabled (streaming) ---"
echo
curl -s -N -X POST "${ENDPOINT}" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 1000,
    "stream": true,
    "thinking": {
      "type": "enabled",
      "budget_tokens": 5000
    },
    "messages": [
      {"role": "user", "content": "What is 2+2? Think step by step."}
    ]
  }' &
STREAM_PID=$!

sleep 20 && kill $STREAM_PID 2>/dev/null || true
wait $STREAM_PID 2>/dev/null || true
echo
echo

echo "========================================="
echo " All tests completed"
echo "========================================="
