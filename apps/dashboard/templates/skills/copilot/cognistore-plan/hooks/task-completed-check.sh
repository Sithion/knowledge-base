#!/usr/bin/env bash
cat <<'EOF'
{
  "systemMessage": "✅ Task completed — sync CogniStore plan:\nupdatePlanTask(taskId, {status: 'completed', notes: '...'})\nupdatePlanTask(nextTaskId, {status: 'in_progress'})"
}
EOF
