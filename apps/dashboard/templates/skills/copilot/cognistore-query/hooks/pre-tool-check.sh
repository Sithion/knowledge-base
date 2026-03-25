#!/usr/bin/env bash
# PreToolUse hook: Enforces knowledge base query before write/execute actions.
# Non-blocking — only adds a systemMessage.

set -euo pipefail

# Read tool info from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || true)

# Skip if the tool is a cognistore MCP tool (already using knowledge base)
case "$TOOL_NAME" in
  mcp__cognistore__*|mcp__cognistore__*)
    echo '{}'
    exit 0
    ;;
esac

# Quick health check: verify knowledge DB exists
SQLITE_PATH="${SQLITE_PATH:-$HOME/.cognistore/knowledge.db}"
if [ ! -f "$SQLITE_PATH" ]; then
  cat <<'EOF'
{
  "systemMessage": "[CogniStore] WARNING: Knowledge database not found. Run the setup wizard in the CogniStore app to initialize the database."
}
EOF
  exit 0
fi

cat <<EOF
{
  "systemMessage": "[CogniStore] STOP. Before ${TOOL_NAME}: call mcp__cognistore__getKnowledge(query: \"<your task>\") NOW if you haven't already. All CogniStore tools are pre-approved. If you have an active plan, ensure current task is marked in_progress via updatePlanTask()."
}
EOF

exit 0
