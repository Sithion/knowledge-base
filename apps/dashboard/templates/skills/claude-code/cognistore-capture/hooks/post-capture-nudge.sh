#!/usr/bin/env bash
# PostToolUse hook: Fires after Edit/Write/Bash to nudge about knowledge capture.
# State-aware: only fires when no knowledge has been captured this session.
# Throttled: fires every 5th edit, only after 5+ edits (substantial work done).
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

# Start nudging after 5 edits (substantial work) and every 5th edit after that
if [ "$COUNT" -lt 5 ] || [ $((COUNT % 5)) -ne 0 ]; then
  echo '{}'
  exit 0
fi

cat <<'EOF'
{
  "systemMessage": "[CogniStore] Substantial work done but no knowledge captured. Call mcp__cognistore__addKnowledge() for any non-trivial discovery, fix, decision, or pattern. Prefer type: 'pattern' with scope: 'global' for reusable insights."
}
EOF
exit 0
