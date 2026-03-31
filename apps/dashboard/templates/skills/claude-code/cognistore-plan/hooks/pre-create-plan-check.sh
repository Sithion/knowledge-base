#!/usr/bin/env bash
# PreToolUse hook: Fires before createPlan MCP call to enforce structured content
set -euo pipefail
touch /tmp/.cognistore-plan-persisted
cat <<'EOF'
{
  "systemMessage": "[CogniStore] PLAN QUALITY CHECK: Ensure your createPlan() content field includes: ## Context (why), ## Approach (how — architecture, data flow, key logic), ## Files to Modify (table with file paths and changes), ## Verification (commands, expected results). Include specific file paths, function names, and line numbers — not generic descriptions. Optional: ## Reusable Code, ## Edge Cases & Risks."
}
EOF
exit 0
