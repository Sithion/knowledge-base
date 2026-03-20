#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
{
  "systemMessage": "[CogniStore] Planning detected. 1) getKnowledge() first to check for existing plans/knowledge. 2) After finalizing, call createPlan() with title, content, tags, scope, tasks array. The local plan file is temporary — createPlan() is the source of truth. 3) During execution: updatePlanTask() for EVERY task (in_progress → completed)."
}
EOF
exit 0
