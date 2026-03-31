#!/usr/bin/env bash
# PostToolUse hook: Fires after ExitPlanMode to ENFORCE plan persistence
# in the knowledge base. Plans MUST go through createPlan().

set -euo pipefail

cat <<'EOF'
{
  "systemMessage": "[CogniStore] REQUIRED ACTION: Call createPlan() NOW if you haven't already. The content field MUST include ## Context, ## Approach, ## Files to Modify (table with paths), and ## Verification sections. Include file paths, function names, and specific technical details. Always include a tasks array. All CogniStore tools are pre-approved. Then track each task: updatePlanTask(taskId, {status: 'in_progress'}) BEFORE starting, updatePlanTask(taskId, {status: 'completed'}) AFTER."
}
EOF

exit 0
