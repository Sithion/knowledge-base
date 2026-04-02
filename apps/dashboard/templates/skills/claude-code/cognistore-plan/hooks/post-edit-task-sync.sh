#!/usr/bin/env bash
# PostToolUse hook: Fires after Edit/Write/Bash to remind about plan task tracking.
# State-aware: only fires when an active plan exists.
# Throttled: fires every 5th edit. Escalates to block after 15+ edits without task update.
set -euo pipefail

PLAN_MARKER="/tmp/.cognistore-active-plan"
COUNTER_FILE="/tmp/.cognistore-edit-count"
TASK_UPDATED="/tmp/.cognistore-task-updated"

# No active plan? Silent exit.
if [ ! -f "$PLAN_MARKER" ]; then
  echo '{}'
  exit 0
fi

PLAN_ID=$(cat "$PLAN_MARKER" 2>/dev/null || true)
if [ -z "$PLAN_ID" ]; then
  echo '{}'
  exit 0
fi

# Increment counter
COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

# If task was recently updated, reset counter and stay silent
if [ -f "$TASK_UPDATED" ]; then
  rm -f "$TASK_UPDATED"
  echo "0" > "$COUNTER_FILE"
  echo '{}'
  exit 0
fi

# Escalate to block after 15+ edits without a task update
if [ "$COUNT" -ge 15 ]; then
  echo "0" > "$COUNTER_FILE"
  cat <<EOF
{
  "decision": "block",
  "reason": "CogniStore: 15+ edits without updating plan tasks. Call mcp__cognistore__listPlanTasks(\"${PLAN_ID}\") then updatePlanTask(taskId, { status: \"completed\" }) for finished tasks NOW."
}
EOF
  exit 0
fi

# Throttle: only fire every 5th edit
if [ $((COUNT % 5)) -ne 0 ]; then
  echo '{}'
  exit 0
fi

cat <<EOF
{
  "systemMessage": "[CogniStore] Active plan ${PLAN_ID}: call updatePlanTask(taskId, {status: \"completed\"}) for finished tasks, then updatePlanTask(nextTaskId, {status: \"in_progress\"}) for the next."
}
EOF
exit 0
