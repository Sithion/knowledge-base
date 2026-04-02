#!/usr/bin/env bash
# PreToolUse hook: BLOCKS tool use until knowledge base has been queried.
# State-aware: goes silent after getKnowledge is called (marker set by post-query-marker.sh).
set -euo pipefail

# Read tool info from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || true)

# Skip if the tool is a cognistore MCP tool (already using knowledge base)
case "$TOOL_NAME" in
  mcp__cognistore__*)
    echo '{}'
    exit 0
    ;;
esac

# If already queried this session, silent pass
if [ -f /tmp/.cognistore-queried ]; then
  echo '{}'
  exit 0
fi

# Quick health check: verify knowledge DB exists
SQLITE_PATH="${SQLITE_PATH:-$HOME/.cognistore/knowledge.db}"
if [ ! -f "$SQLITE_PATH" ]; then
  cat <<'EOF'
{
  "decision": "block",
  "reason": "[CogniStore] Knowledge database not found. Run the setup wizard in the CogniStore app to initialize."
}
EOF
  exit 0
fi

# Block until getKnowledge is called
cat <<EOF
{
  "decision": "block",
  "reason": "CogniStore: You must call mcp__cognistore__getKnowledge(query: \"<your task>\") before using ${TOOL_NAME}. All CogniStore tools are pre-approved — call directly."
}
EOF
exit 0
