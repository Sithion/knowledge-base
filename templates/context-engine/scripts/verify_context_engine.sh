#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv-context"

PASS=0
FAIL=0

check() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  [PASS] ${desc}"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] ${desc}"
    FAIL=$((FAIL + 1))
  fi
}

echo "[verify] root: ${ROOT_DIR}"
echo ""

echo "=== Structure ==="
check ".ai directory exists" test -d "${ROOT_DIR}/.ai"
check ".ai/context exists" test -d "${ROOT_DIR}/.ai/context"
check ".ai/memory exists" test -d "${ROOT_DIR}/.ai/memory"
check ".ai/summaries exists" test -d "${ROOT_DIR}/.ai/summaries"
check ".ai/index exists" test -d "${ROOT_DIR}/.ai/index"
check ".ai/agents exists" test -d "${ROOT_DIR}/.ai/agents"
check "requirements-context.txt exists" test -f "${ROOT_DIR}/requirements-context.txt"

echo ""
echo "=== Template Files ==="
check "architecture.md" test -f "${ROOT_DIR}/.ai/context/architecture.md"
check "coding_standards.md" test -f "${ROOT_DIR}/.ai/context/coding_standards.md"
check "role_policies.yaml" test -f "${ROOT_DIR}/.ai/agents/role_policies.yaml"
check "llm_agents_map.yaml" test -f "${ROOT_DIR}/.ai/agents/llm_agents_map.yaml"
check "routing.yaml" test -f "${ROOT_DIR}/.ai/agents/routing.yaml"
check "context_policy.md" test -f "${ROOT_DIR}/.ai/agents/context_policy.md"
check "decisions.log" test -f "${ROOT_DIR}/.ai/memory/decisions.log"

echo ""
echo "=== Python Scripts ==="
check "config.py" test -f "${ROOT_DIR}/.ai/index/config.py"
check "build_index.py" test -f "${ROOT_DIR}/.ai/index/build_index.py"
check "retrieve.py" test -f "${ROOT_DIR}/.ai/index/retrieve.py"
check "dependency_graph.py" test -f "${ROOT_DIR}/.ai/index/dependency_graph.py"
check "summarize.py" test -f "${ROOT_DIR}/.ai/index/summarize.py"

echo ""
echo "=== Python Dependencies ==="
if [[ -d "${VENV_DIR}" ]]; then
  source "${VENV_DIR}/bin/activate"
  for mod in yaml networkx tiktoken chromadb llama_index sentence_transformers; do
    check "import ${mod}" python -c "import ${mod}"
  done
else
  echo "  [SKIP] venv not found at ${VENV_DIR} — run setup_context_engine.sh first"
fi

echo ""
echo "=== Functional Tests ==="
if [[ -d "${VENV_DIR}" ]]; then
  source "${VENV_DIR}/bin/activate"
  check "build_index.py --dry-run" python "${ROOT_DIR}/.ai/index/build_index.py" --dry-run
  check "dependency_graph.py show" python "${ROOT_DIR}/.ai/index/dependency_graph.py" show
  check "retrieve.py (missing index)" python "${ROOT_DIR}/.ai/index/retrieve.py" "test query" 2>/dev/null
else
  echo "  [SKIP] venv not found"
fi

echo ""
echo "=== Results ==="
echo "  Passed: ${PASS}"
echo "  Failed: ${FAIL}"

if [[ ${FAIL} -gt 0 ]]; then
  echo ""
  echo "[verify] SOME CHECKS FAILED — review output above"
  exit 1
else
  echo ""
  echo "[verify] ALL CHECKS PASSED"
fi
