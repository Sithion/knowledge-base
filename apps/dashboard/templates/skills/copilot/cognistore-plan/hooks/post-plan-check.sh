#!/usr/bin/env bash
# PostToolUse hook: Fires after plan-related actions to ENFORCE plan persistence
# in the knowledge base. Plans MUST go through createPlan().

set -euo pipefail

cat <<'EOF'
{
  "systemMessage": "[CogniStore] REQUIRED ACTION: Call mcp__cognistore__createPlan({ title: \"<plan title>\", content: \"<plan content>\", tags: [...], scope: \"workspace:<project>\", source: \"plan-mode\", tasks: [{description: \"Step 1\", priority: \"high\"}, ...], relatedKnowledgeIds: [\"<ids from getKnowledge>\"] }) NOW if you haven't already. All CogniStore tools are pre-approved. Then track each task: updatePlanTask(taskId, {status: 'in_progress'}) BEFORE starting, updatePlanTask(taskId, {status: 'completed'}) AFTER."
}
EOF

exit 0
