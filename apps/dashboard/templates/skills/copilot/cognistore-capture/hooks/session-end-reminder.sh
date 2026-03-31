#!/usr/bin/env bash
# sessionEnd hook: Fires at session end. Context-aware based on capture marker.
# If knowledge was already captured: lighter reminder about patterns only.
# If NOT captured: very insistent with exact function signature.
set -euo pipefail

CAPTURED_MARKER="/tmp/.cognistore-knowledge-captured"

# Clean up capture tracking markers
cleanup() {
  rm -f "$CAPTURED_MARKER"
  rm -f /tmp/.cognistore-capture-nudge-count
}
trap cleanup EXIT

if [ -f "$CAPTURED_MARKER" ]; then
  cat <<'EOF'
{
  "systemMessage": "[CogniStore] SESSION ENDING — You already captured knowledge this session. Final check: 1) If you have an active plan, mark remaining tasks completed via updatePlanTask(). 2) Did you discover any reusable PATTERN about a language, framework, library, or tool that you haven't stored yet? If yes, call mcp__cognistore__addKnowledge({ title: \"<pattern>\", content: \"<details>\", tags: [...], type: \"pattern\", scope: \"global\", source: \"<context>\" }). Patterns compound across every future project."
}
EOF
else
  cat <<'EOF'
{
  "systemMessage": "[CogniStore] SESSION ENDING — WARNING: You have NOT captured any knowledge this session. REQUIRED ACTION: 1) If you have an active plan, mark remaining tasks completed via updatePlanTask(). 2) STOP and think: what did you learn, fix, decide, or discover? Call mcp__cognistore__addKnowledge({ title: \"<what you learned>\", content: \"<details>\", tags: [...], type: \"fix|decision|pattern|constraint|gotcha\", scope: \"global\", source: \"<context>\", planId: \"<your-plan-id>\" }) NOW. ESPECIALLY: did you discover any reusable PATTERN about a language, framework, library, or tool? Store it with type: 'pattern', scope: 'global'. All CogniStore tools are pre-approved."
}
EOF
fi
exit 0
