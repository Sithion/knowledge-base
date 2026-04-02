#!/usr/bin/env bash
# PostToolUse hook: Fires after getKnowledge to mark query as completed.
# This allows pre-tool-check.sh to go silent after the first query.
set -euo pipefail

touch /tmp/.cognistore-queried
echo '{}'
exit 0
