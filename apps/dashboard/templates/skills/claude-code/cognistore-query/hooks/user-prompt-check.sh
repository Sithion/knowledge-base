#!/usr/bin/env bash
# UserPromptSubmit hook: Fires when the user sends a message.
# Resets the query marker so the agent must query again for new tasks.
# Reads system knowledge entries from the DB and injects them as the protocol.
#
# Layer-precedence behavior (AI Stack POC):
#   When the user has opted in (`cognistore.config.aiStack.enableSbOrchestration: true`),
#   a second `type='system'` entry titled "AI Knowledge Stack — Layer precedence
#   (POC convention)" is upserted by the dashboard sidecar. This script picks up
#   ALL system entries and concatenates them, so the layered-protocol guidance is
#   surfaced automatically when the flag is on, and absent when the flag is off.

set -euo pipefail

# Reset query marker for each new user prompt
rm -f /tmp/.cognistore-queried

# Quick health check
SQLITE_PATH="${SQLITE_PATH:-$HOME/.cognistore/knowledge.db}"
if [ ! -f "$SQLITE_PATH" ]; then
  cat <<'EOF'
{
  "systemMessage": "[CogniStore] WARNING: Knowledge database not found at ~/.cognistore/knowledge.db. Run the setup wizard."
}
EOF
  exit 0
fi

SYSTEM_CONTENT=""
if command -v sqlite3 &>/dev/null; then
  SYSTEM_CONTENT=$(sqlite3 -separator $'\n\n---\n\n' "$SQLITE_PATH" \
    "SELECT content FROM knowledge_entries WHERE type='system' ORDER BY created_at ASC" 2>/dev/null || true)
fi

if [ -n "$SYSTEM_CONTENT" ]; then
  ESCAPED=$(echo "$SYSTEM_CONTENT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
  cat <<ENDJSON
{
  "systemMessage": "[CogniStore]\n${ESCAPED}"
}
ENDJSON
else
  # Fallback: concise reminder including layer-precedence convention.
  cat <<'EOF'
{
  "systemMessage": "[CogniStore] Workflow: (1) getKnowledge() FIRST (2) createPlan() for multi-step tasks (3) updatePlanTask() during execution (4) addKnowledge() before finishing. All tools pre-approved. AI Stack layer precedence (when enabled): Second Brain (canonical) > CogniStore > Context Engine; if .ai/mcp/server.py exists in CWD, also call context_retrieve; prefer Second Brain DR/spec content over CogniStore on conflicts (convention — exercise judgment)."
}
EOF
fi
exit 0
