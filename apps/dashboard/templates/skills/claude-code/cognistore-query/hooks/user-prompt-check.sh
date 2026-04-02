#!/usr/bin/env bash
# UserPromptSubmit hook: Fires when the user sends a message.
# Resets the query marker so the agent must query again for new tasks.
# Injects a concise protocol reminder (full protocol lives in CLAUDE.md).
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

cat <<'EOF'
{
  "systemMessage": "[CogniStore] Workflow: (1) getKnowledge() FIRST (2) createPlan() for multi-step tasks (3) updatePlanTask() during execution (4) addKnowledge() before finishing. All tools pre-approved."
}
EOF
exit 0
