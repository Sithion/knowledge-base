#!/usr/bin/env bash
# PostToolUse hook: Fires after updatePlan().
# Cleans up /tmp markers when plan is completed.
set -euo pipefail

INPUT=$(cat)

# Check if the update set status to "completed"
if echo "$INPUT" | grep -q '"status":"completed"' 2>/dev/null; then
  rm -f /tmp/.cognistore-active-plan
  rm -f /tmp/.cognistore-edit-count
fi

echo '{}'
exit 0
