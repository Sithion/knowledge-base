#!/usr/bin/env bash
# postToolUse hook: Fires after tool use to remind about plan task tracking.
# State-aware: only fires when an active plan exists.
# Throttled: fires every 3rd invocation to reduce noise.
set -euo pipefail

PLAN_MARKER="/tmp/.cognistore-active-plan"
COUNTER_FILE="/tmp/.cognistore-edit-count"

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

# Throttle: only fire every 3rd invocation to reduce noise
COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

if [ $((COUNT % 3)) -ne 0 ]; then
  echo '{}'
  exit 0
fi

cat <<EOF
{
  "systemMessage": "STOP. You have an active CogniStore plan (${PLAN_ID}). Call mcp__cognistore__updatePlanTask(taskId, { status: \"completed\", notes: \"<what you just did>\" }) NOW for any task you just finished. Then call mcp__cognistore__updatePlanTask(nextTaskId, { status: \"in_progress\" }) for the next task. If you don't know the taskIds, call mcp__cognistore__listPlanTasks(\"${PLAN_ID}\") first."
}
EOF
exit 0
