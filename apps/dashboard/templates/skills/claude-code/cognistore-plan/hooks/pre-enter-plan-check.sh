#!/usr/bin/env bash
set -euo pipefail
cat <<'EOF'
{
  "systemMessage": "[CogniStore] MANDATORY — PLAN MODE DETECTED:\n\nBEFORE you start planning, you MUST:\n\n1. **Query knowledge first** (if not already done):\n   mcp__cognistore__getKnowledge(query: \"<describe the task>\")\n\n2. **Check for existing draft plans** to avoid duplicates:\n   mcp__cognistore__getKnowledge(query: \"<plan topic>\")\n   If a draft plan exists on the same topic, RESUME it instead of creating a new one.\n\n3. **Use createPlan() to persist the plan** — this is MANDATORY:\n   mcp__cognistore__createPlan({ title, content, tags, scope, source, tasks })\n   The local plan file (.claude/plans/) is a temporary artifact.\n   It is NOT a substitute for createPlan(). The knowledge base is the ONLY source of truth.\n\n4. **Always include a tasks array** with every implementation step.\n\nDo NOT skip createPlan(). Do NOT treat the local plan file as the final plan. Do NOT create a duplicate if a draft already exists on this topic."
}
EOF
exit 0
