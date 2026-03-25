#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
{
  "systemMessage": "[CogniStore] PLAN MODE: 1) Call getKnowledge() first — it's pre-approved. 2) Write your plan file. 3) Call createPlan() BEFORE exiting plan mode — MCP tools work in plan mode, all are pre-approved. 4) Exit plan mode. 5) During execution: updatePlanTask() for EVERY task (in_progress → completed)."
}
EOF
exit 0
