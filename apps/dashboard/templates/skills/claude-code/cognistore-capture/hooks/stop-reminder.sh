#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
{
  "systemMessage": "[CogniStore] SESSION ENDING — REQUIRED: 1) If you have an active plan, mark remaining tasks completed via updatePlanTask(). 2) Call mcp__cognistore__addKnowledge({ title: \"<what you learned>\", content: \"<details>\", tags: [...], type: \"fix|decision|pattern|constraint|gotcha\", scope: \"workspace:<project>\", source: \"<context>\", planId: \"<your-plan-id>\" }) for any non-trivial discoveries. All CogniStore tools are pre-approved."
}
EOF
exit 0
