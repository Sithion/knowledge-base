#!/usr/bin/env bash
cat <<'EOF'
{
  "systemMessage": "⚠️ Subagent completed — reconcile plan tracking:\n1. listPlanTasks(planId) to check task statuses\n2. updatePlanTask(taskId, {status: 'completed'}) for finished tasks\n3. updatePlanTask(nextTaskId, {status: 'in_progress'}) for next task"
}
EOF
