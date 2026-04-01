#!/usr/bin/env bash
# PostToolUse hook: Fires after addKnowledge.
# Sets marker to indicate knowledge was captured this session.
# Resets capture nudge counter — positive reinforcement (fewer reminders when compliant).
set -euo pipefail

echo "1" > /tmp/.cognistore-knowledge-captured
echo "0" > /tmp/.cognistore-capture-nudge-count
echo '{}'
exit 0
