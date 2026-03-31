#!/usr/bin/env bash
# PostToolUse hook: Fires after createPlan() to set active plan marker.
# Writes planId to /tmp so other hooks can reference it.
set -euo pipefail

INPUT=$(cat)
# Extract planId from createPlan response JSON
PLAN_ID=$(echo "$INPUT" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4 2>/dev/null || true)

if [ -n "$PLAN_ID" ]; then
  echo "$PLAN_ID" > /tmp/.cognistore-active-plan
  echo "0" > /tmp/.cognistore-edit-count
fi

cat <<'EOF'
{
  "systemMessage": "STOP. Plan created. You MUST now track every task in real-time. Call mcp__cognistore__listPlanTasks(planId) NOW to get your taskIds. Then BEFORE each task: mcp__cognistore__updatePlanTask(taskId, { status: \"in_progress\" }). AFTER each task: mcp__cognistore__updatePlanTask(taskId, { status: \"completed\", notes: \"...\" }). Do NOT proceed to implementation without marking the first task in_progress."
}
EOF
exit 0
