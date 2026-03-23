#!/usr/bin/env bash
cat <<'EOF'
{
  "systemMessage": "🛑 Session ending — two checks:\n\n1. Plan Completion: listPlanTasks(planId), mark incomplete tasks completed\n2. Knowledge Capture: addKnowledge() for new insights (pass planId)\n\nDo NOT end with an active plan or uncaptured knowledge."
}
EOF
