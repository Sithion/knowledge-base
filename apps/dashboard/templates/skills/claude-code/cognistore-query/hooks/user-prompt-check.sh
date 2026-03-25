#!/usr/bin/env bash
# UserPromptSubmit hook: Fires IMMEDIATELY when the user sends a message,
# BEFORE the agent starts thinking or using any tools.
# Injects system knowledge (mandatory workflow protocol) into agent context.
# Non-blocking — only adds a systemMessage.

set -euo pipefail

# Quick health check: verify knowledge DB exists
SQLITE_PATH="${SQLITE_PATH:-$HOME/.cognistore/knowledge.db}"
if [ ! -f "$SQLITE_PATH" ]; then
  cat <<'EOF'
{
  "systemMessage": "[CogniStore] WARNING: Knowledge database not found at ~/.cognistore/knowledge.db. Run the setup wizard in the CogniStore app to initialize."
}
EOF
  exit 0
fi

# Try to read system knowledge from DB
SYSTEM_CONTENT=""
if command -v sqlite3 &>/dev/null; then
  SYSTEM_CONTENT=$(sqlite3 "$SQLITE_PATH" "SELECT content FROM knowledge_entries WHERE type='system' LIMIT 1" 2>/dev/null || true)
fi

if [ -n "$SYSTEM_CONTENT" ]; then
  # Escape for JSON: replace newlines, quotes, backslashes
  ESCAPED=$(echo "$SYSTEM_CONTENT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
  cat <<ENDJSON
{
  "systemMessage": "[COGNISTORE-PROTOCOL]\n${ESCAPED}\n[END PROTOCOL]"
}
ENDJSON
else
  # Fallback: hardcoded protocol if sqlite3 unavailable or no system entry
  cat <<'EOF'
{
  "systemMessage": "[COGNISTORE-PROTOCOL]\nCRITICAL: On EVERY task you MUST follow this workflow. All CogniStore tools are pre-approved — call them directly.\n1. FIRST: mcp__cognistore__getKnowledge(query: \"<task>\"). Save returned entry IDs.\n2. PLAN: For 2+ steps, mcp__cognistore__createPlan({ title, content, tags, scope, source, tasks: [...], relatedKnowledgeIds: [\"<ids>\"] }). Save planId.\n3. TRACK: mcp__cognistore__updatePlanTask(taskId, { status: \"in_progress\" }) before each task, \"completed\" after. Plan activates and completes automatically.\n4. SAVE: mcp__cognistore__addKnowledge({ title, content, tags, type, scope, source, planId: \"<plan-id>\" }) before finishing. All entries in English.\n[END PROTOCOL]"
}
EOF
fi

exit 0
