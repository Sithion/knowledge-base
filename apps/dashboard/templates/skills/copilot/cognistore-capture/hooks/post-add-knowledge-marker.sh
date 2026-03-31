#!/usr/bin/env bash
# postToolUse hook: Fires after addKnowledge.
# Sets marker to indicate knowledge was captured this session.
# Resets capture nudge counter — positive reinforcement.
set -euo pipefail

echo "1" > /tmp/.cognistore-knowledge-captured
echo "0" > /tmp/.cognistore-capture-nudge-count
echo '{}'
exit 0
