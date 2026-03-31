#!/usr/bin/env bash
set -euo pipefail
rm -f /tmp/.cognistore-plan-persisted
cat <<'EOF'
{
  "systemMessage": "[CogniStore] PLAN MODE: 1) Call getKnowledge() first — it's pre-approved. 2) Write your plan file. 3) Call createPlan() BEFORE ExitPlanMode — the content MUST include ## Context, ## Approach, ## Files to Modify (table with paths), and ## Verification. MCP tools work in plan mode, all are pre-approved. 4) ExitPlanMode. 5) During execution: updatePlanTask() for EVERY task (in_progress → completed)."
}
EOF
exit 0
