#!/usr/bin/env bash
# PostToolUse hook: Fires after updatePlanTask/updatePlanTasks.
# Resets edit counter and sets task-updated marker — positive reinforcement.
set -euo pipefail

echo "0" > /tmp/.cognistore-edit-count
touch /tmp/.cognistore-task-updated
echo '{}'
exit 0
