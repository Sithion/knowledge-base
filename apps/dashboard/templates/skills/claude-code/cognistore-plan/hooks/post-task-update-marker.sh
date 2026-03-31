#!/usr/bin/env bash
# PostToolUse hook: Fires after updatePlanTask/updatePlanTasks.
# Resets edit counter — positive reinforcement (fewer reminders when compliant).
set -euo pipefail

echo "0" > /tmp/.cognistore-edit-count
echo '{}'
exit 0
