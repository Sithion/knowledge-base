#!/usr/bin/env bash
# PreToolUse hook: Reminds the agent to query the knowledge base before
# performing write/execute actions. Includes a lightweight health check.
# Non-blocking — only adds a systemMessage.

set -euo pipefail

# Read tool info from stdin
INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || true)

# Skip if the tool is an cognistore MCP tool (already using knowledge base)
case "$TOOL_NAME" in
  mcp__cognistore__*|mcp__cognistore__*)
    echo '{}'
    exit 0
    ;;
esac

# Quick health check: verify MCP server is reachable
# Try to connect to the knowledge DB — if it fails, warn instead of blocking
SQLITE_PATH="${SQLITE_PATH:-$HOME/.cognistore/knowledge.db}"
if [ ! -f "$SQLITE_PATH" ]; then
  cat <<'EOF'
{
  "systemMessage": "[CogniStore] WARNING: Knowledge database not found. Run the setup wizard in the CogniStore app to initialize the database."
}
EOF
  exit 0
fi

# Build contextual reminder based on the tool being used
case "$TOOL_NAME" in
  Edit|MultiEdit|Write|NotebookEdit)
    ACTION="editing files"
    ;;
  Bash)
    ACTION="running commands"
    ;;
  Agent)
    ACTION="delegating to a sub-agent"
    ;;
  *)
    ACTION="making changes"
    ;;
esac

cat <<EOF
{
  "systemMessage": "[CogniStore] MANDATORY: You are about to start ${ACTION} (${TOOL_NAME}). Have you queried mcp__cognistore__getKnowledge() first? Check for existing patterns, decisions, and fixes before proceeding. A single query costs ~30 tokens — a missed cache hit wastes thousands on redundant work.\n\nPlan tracking: If you have an active plan, ensure the current task is marked in_progress before proceeding."
}
EOF

exit 0
