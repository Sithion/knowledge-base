#!/usr/bin/env bash
# Stop hook: Reminds the agent to capture knowledge after completing work.
# Provides specific guidance on what to capture based on common work patterns.
# Non-blocking — only adds a systemMessage.

set -euo pipefail

cat <<'EOF'
{
  "systemMessage": "[AI Knowledge] MANDATORY: Before finishing this session, capture any new knowledge you discovered.\n\nAsk yourself:\n- Did I fix a bug? → type: 'fix' (include root cause + prevention)\n- Did I make a technical decision? → type: 'decision' (include reasoning + alternatives discarded)\n- Did I find a useful pattern? → type: 'pattern' (include where/how to reuse)\n- Did I hit a limitation? → type: 'constraint' (include workaround)\n- Did I encounter unexpected behavior? → type: 'gotcha' (include symptoms + fix)\n\nCall mcp__ai-knowledge__addKnowledge() with: content, tags, type, scope, source.\nAll entries MUST be in English. Every entry builds institutional memory for future sessions."
}
EOF

exit 0
