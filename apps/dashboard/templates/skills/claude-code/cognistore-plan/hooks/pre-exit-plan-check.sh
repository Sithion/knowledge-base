#!/usr/bin/env bash
# PreToolUse hook: Blocks ExitPlanMode if createPlan() was not called first.
# Uses /tmp/.cognistore-plan-persisted as a gate marker.
set -euo pipefail

if [ -f /tmp/.cognistore-plan-persisted ]; then
  rm -f /tmp/.cognistore-plan-persisted
  echo '{}'
  exit 0
fi

cat <<'EOF'
{
  "decision": "block",
  "reason": "You MUST call createPlan() before ExitPlanMode. The local plan file is temporary — createPlan() is the persistent source of truth. Call createPlan() now with title, content (## Context, ## Approach, ## Files to Modify, ## Verification), tags, scope, source, and tasks array. All CogniStore tools are pre-approved."
}
EOF
exit 0
