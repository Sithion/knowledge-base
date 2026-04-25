#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv-context"

echo "[setup] root: ${ROOT_DIR}"

# Verify Python 3.10+
PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "0.0")
PYTHON_MAJOR=$(echo "${PYTHON_VERSION}" | cut -d. -f1)
PYTHON_MINOR=$(echo "${PYTHON_VERSION}" | cut -d. -f2)
if [[ "${PYTHON_MAJOR}" -lt 3 ]] || [[ "${PYTHON_MAJOR}" -eq 3 && "${PYTHON_MINOR}" -lt 10 ]]; then
  echo "[error] Python 3.10+ required, found ${PYTHON_VERSION}"
  exit 1
fi

# Create directory structure
dirs=(
  ".ai/context"
  ".ai/memory"
  ".ai/summaries"
  ".ai/index"
  ".ai/agents"
  ".ai/tasks/active"
  ".ai/tasks/completed"
  "scripts"
)
for d in "${dirs[@]}"; do
  mkdir -p "${ROOT_DIR}/${d}"
done

# Create venv if missing
if [[ ! -d "${VENV_DIR}" ]]; then
  echo "[setup] creating venv at ${VENV_DIR}"
  if python3 -m venv "${VENV_DIR}" 2>/dev/null; then
    :
  elif command -v virtualenv &>/dev/null; then
    echo "[setup] venv module unavailable, falling back to virtualenv"
    virtualenv "${VENV_DIR}"
  else
    echo "[error] cannot create venv. Install python3-venv or virtualenv."
    exit 1
  fi
fi

source "${VENV_DIR}/bin/activate"
python -m pip install --upgrade pip -q
pip install -r "${ROOT_DIR}/requirements-context.txt" -q

chmod +x "${ROOT_DIR}/scripts/"*.sh 2>/dev/null || true

echo "[setup] dependencies installed"
echo "[setup] to build index: source ${VENV_DIR}/bin/activate && python ${ROOT_DIR}/.ai/index/build_index.py"
echo "[setup] complete"
