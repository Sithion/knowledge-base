#!/usr/bin/env bash
# ContextEngineDetect — fires once per session at start.
# If CWD looks like a git repo with no `.ai/index/` and no opt-out marker,
# emits a one-shot systemMessage prompting the agent to ask the user about
# initializing Context Engine via the MCP `stackInit` tool.
#
# Respects:
#   - CI env var (any truthy → skip)
#   - .ai/.no-context-engine opt-out marker
#   - cognistore.config.contextEnginePromptDisabled (read from
#     ~/.cognistore/config.json if present)
#   - $COGNISTORE_CONTEXT_ENGINE_PROMPT_DISABLED env override
#   - Per-session dedupe via $TMPDIR/.cognistore-ce-detect-<pid>
#
# Output: prints a JSON object with a `systemMessage` key when the prompt
# should fire; prints nothing otherwise.

set -uo pipefail

# CI suppression
if [ -n "${CI:-}" ]; then
  exit 0
fi

# Global config / env opt-out
if [ "${COGNISTORE_CONTEXT_ENGINE_PROMPT_DISABLED:-}" = "1" ] || \
   [ "${COGNISTORE_CONTEXT_ENGINE_PROMPT_DISABLED:-}" = "true" ]; then
  exit 0
fi

CONFIG_FILE="${HOME}/.cognistore/config.json"
if [ -f "$CONFIG_FILE" ] && command -v node >/dev/null 2>&1; then
  DISABLED=$(node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
      const v = c?.contextEnginePromptDisabled;
      process.stdout.write(v === true ? '1' : '');
    } catch { process.stdout.write(''); }
  " "$CONFIG_FILE" 2>/dev/null || echo "")
  if [ "$DISABLED" = "1" ]; then
    exit 0
  fi
fi

# Must be a git repo
if [ ! -d ".git" ] && ! git rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# Already initialized → skip
if [ -d ".ai/index" ]; then
  exit 0
fi

# Opt-out marker
if [ -f ".ai/.no-context-engine" ]; then
  exit 0
fi

# Per-session dedupe — keyed by parent PID (the agent process).
DEDUP_DIR="${TMPDIR:-/tmp}"
DEDUP_FILE="${DEDUP_DIR}/.cognistore-ce-detect-${PPID}"
if [ -f "$DEDUP_FILE" ]; then
  exit 0
fi
touch "$DEDUP_FILE" 2>/dev/null || true

REPO_PATH="$(pwd)"
cat <<JSON
{
  "systemMessage": "[CONTEXT-ENGINE-DETECT] No Context Engine setup detected at ${REPO_PATH}. To initialize, ask: 'Initialize Context Engine here? [Y/n/never]'. On Y: call mcp__cognistore__stackInit({ repoPath: \"${REPO_PATH}\" }). On never: write the file ${REPO_PATH}/.ai/.no-context-engine to suppress this prompt permanently. On n: skip for this session only."
}
JSON
