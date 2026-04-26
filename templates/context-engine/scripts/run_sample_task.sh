#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv-context"

TASK_TEXT="${1:-sample task: inspect auth flow and suggest minimal fix context}"

if [[ ! -d "${VENV_DIR}" ]]; then
  echo "[error] venv not found at ${VENV_DIR}"
  echo "[error] run scripts/setup_context_engine.sh first"
  exit 1
fi

source "${VENV_DIR}/bin/activate"

echo "[sample] Step 1: Retrieve context for task"
echo "  Task: ${TASK_TEXT}"
echo ""
python "${ROOT_DIR}/.ai/index/retrieve.py" "${TASK_TEXT}" --top-k 10 || true

echo ""
echo "[sample] Step 2: (placeholder) Invoke agent via OpenCode/OhMyOpenAgent"
echo "  In a real workflow, the retrieved context above would be injected into the agent prompt."
echo "  Example: opencode run --context <retrieved_files> --task '${TASK_TEXT}'"

echo ""
echo "[sample] Step 3: Record what was done"
echo "  After task completion, run:"
echo "    python .ai/index/summarize.py record --diff --message 'description of changes'"

echo ""
echo "[sample] Step 4: Rebuild index (if source files changed)"
echo "    python .ai/index/build_index.py"
