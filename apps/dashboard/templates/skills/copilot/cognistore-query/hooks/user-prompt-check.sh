#!/usr/bin/env bash
# UserPromptSubmit hook: Fires IMMEDIATELY when the user sends a message,
# BEFORE the agent starts thinking or using any tools.
# Injects system knowledge (mandatory workflow protocol) into agent context.
# Non-blocking — only adds a systemMessage.
#
# Layer-precedence behavior (AI Stack POC):
#   When the user has opted in (`cognistore.config.aiStack.enableSbOrchestration: true`),
#   a second `type='system'` entry titled "AI Knowledge Stack — Layer precedence
#   (POC convention)" is upserted by the dashboard sidecar. This script picks up
#   ALL system entries and concatenates them, so the layered-protocol guidance is
#   surfaced automatically when the flag is on, and absent when the flag is off.

set -euo pipefail

SQLITE_PATH="${SQLITE_PATH:-$HOME/.cognistore/knowledge.db}"
if [ ! -f "$SQLITE_PATH" ]; then
  cat <<'EOF'
{
  "systemMessage": "[CogniStore] WARNING: Knowledge database not found at ~/.cognistore/knowledge.db. Run the setup wizard in the CogniStore app to initialize."
}
EOF
  exit 0
fi

# Concatenate ALL system entries (workflow + optional layer-precedence). Newest first
# so newly-added system guidance is surfaced even if older content lingers.
SYSTEM_CONTENT=""
if command -v sqlite3 &>/dev/null; then
  SYSTEM_CONTENT=$(sqlite3 -separator $'\n\n---\n\n' "$SQLITE_PATH" \
    "SELECT content FROM knowledge_entries WHERE type='system' ORDER BY created_at ASC" 2>/dev/null || true)
fi

if [ -n "$SYSTEM_CONTENT" ]; then
  # Escape for JSON: replace backslashes, quotes, then newlines.
  ESCAPED=$(echo "$SYSTEM_CONTENT" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')
  cat <<ENDJSON
{
  "systemMessage": "[COGNISTORE-PROTOCOL]\n${ESCAPED}\n[END PROTOCOL]"
}
ENDJSON
else
  # Fallback: hardcoded protocol if sqlite3 unavailable or no system entry.
  # Includes the layer-precedence convention as a soft norm — agents can still
  # apply judgment when conflicts arise.
  cat <<'EOF'
{
  "systemMessage": "[COGNISTORE-PROTOCOL]\nCRITICAL: On EVERY task you MUST follow this workflow. All CogniStore tools are pre-approved — call them directly.\n1. FIRST: mcp__cognistore__getKnowledge(query: \"<task>\"). Save returned entry IDs.\n2. PLAN: For 2+ steps, mcp__cognistore__createPlan({ title, content, tags, scope, source, tasks: [...], relatedKnowledgeIds: [\"<ids>\"] }). Save planId.\n3. TRACK: mcp__cognistore__updatePlanTask(taskId, { status: \"in_progress\" }) before each task, \"completed\" after. Plan activates and completes automatically.\n4. SAVE: mcp__cognistore__addKnowledge({ title, content, tags, type, scope, source, planId: \"<plan-id>\" }) before finishing. All entries in English.\n\nLayer precedence (AI Stack POC convention — when enabled): Second Brain (canonical) > CogniStore (runtime mirror) > Context Engine (per-repo). If `.ai/mcp/server.py` exists in CWD, also call context_retrieve. When conflicts arise, prefer Second Brain DR/spec content over CogniStore entries — this is a convention, exercise judgment.\n[END PROTOCOL]"
}
EOF
fi

exit 0
