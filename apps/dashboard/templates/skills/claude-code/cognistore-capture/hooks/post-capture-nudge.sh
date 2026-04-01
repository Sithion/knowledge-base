#!/usr/bin/env bash
# PostToolUse hook: Fires after Edit/Write/Bash to nudge about knowledge capture.
# State-aware: only fires when no knowledge has been captured this session.
# Throttled: fires every 5th edit, only after 10+ edits (substantial work done).
set -euo pipefail

CAPTURED_MARKER="/tmp/.cognistore-knowledge-captured"
COUNTER_FILE="/tmp/.cognistore-capture-nudge-count"

# Already captured knowledge this session? Silent exit.
if [ -f "$CAPTURED_MARKER" ]; then
  echo '{}'
  exit 0
fi

# Increment counter
COUNT=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

# Only start nudging after 10 edits (substantial work) and every 5th edit after that
if [ "$COUNT" -lt 10 ] || [ $((COUNT % 5)) -ne 0 ]; then
  echo '{}'
  exit 0
fi

cat <<'EOF'
{
  "systemMessage": "[CogniStore] You have done substantial work but have NOT captured any knowledge yet. REQUIRED ACTION: Call mcp__cognistore__addKnowledge({ title: \"<what you learned>\", content: \"<details>\", tags: [...], type: \"fix|decision|pattern|constraint|gotcha\", scope: \"global\", source: \"<context>\", planId: \"<your-plan-id>\" }) for any non-trivial discovery. Did you find a reusable PATTERN about a language, framework, or tool? Store it with type: 'pattern', scope: 'global'. Patterns compound across every future project. All CogniStore tools are pre-approved — call directly."
}
EOF
exit 0
