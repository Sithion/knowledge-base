#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<EOF
Usage: bootstrap_real_repo.sh [--sb-project=<slug>] <path-to-real-repo>

Copies the context-engine scaffold into <path-to-real-repo>. As a final step,
pulls canonical Second Brain content into <repo>/.ai/context/sb-derived/ if a
project slug is known.

Options:
  --sb-project=<slug>  Second Brain project slug to mirror. Written into
                       <repo>/.ai/sb-project-link. If omitted, the script
                       prompts for a value (or reads an existing link file).
  --no-sb              Skip the SB pull step entirely.
  -h, --help           Show this help and exit.
EOF
}

SB_PROJECT=""
SKIP_SB=0
TARGET_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --sb-project=*) SB_PROJECT="${1#--sb-project=}"; shift ;;
    --sb-project) SB_PROJECT="${2:-}"; shift 2 ;;
    --no-sb) SKIP_SB=1; shift ;;
    -*) echo "[bootstrap] unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) TARGET_DIR="$1"; shift ;;
  esac
done

if [[ -z "${TARGET_DIR}" ]]; then
  echo "[bootstrap] missing target repo path" >&2
  usage >&2
  exit 2
fi

if [[ ! -d "${TARGET_DIR}" ]]; then
  echo "[error] directory not found: ${TARGET_DIR}"
  exit 1
fi

echo "[bootstrap] Copying context-engine scaffold into: ${TARGET_DIR}"

# Copy .ai structure (don't overwrite existing files)
copy_if_missing() {
  local src="$1"
  local dst="$2"
  if [[ -f "${dst}" ]]; then
    echo "  [skip] ${dst} (already exists)"
  else
    mkdir -p "$(dirname "${dst}")"
    cp "${src}" "${dst}"
    echo "  [copy] ${dst}"
  fi
}

# Template files (starter content — customize these)
for f in \
  .ai/context/architecture.md \
  .ai/context/coding_standards.md \
  .ai/context/domain_model.md \
  .ai/context/api_contracts.md \
  .ai/summaries/repo_summary.md \
  .ai/summaries/module_template.md \
  .ai/memory/decisions.log \
  .ai/memory/bugs.log \
  .ai/memory/patterns.log \
  .ai/agents/role_policies.yaml \
  .ai/agents/llm_agents_map.yaml \
  .ai/agents/routing.yaml \
  .ai/agents/context_policy.md; do
  if [[ -f "${ROOT_DIR}/${f}" ]]; then
    copy_if_missing "${ROOT_DIR}/${f}" "${TARGET_DIR}/${f}"
  fi
done

# Infrastructure files (use as-is)
for f in \
  .ai/index/config.py \
  .ai/index/build_index.py \
  .ai/index/retrieve.py \
  .ai/index/dependency_graph.py \
  .ai/index/summarize.py \
  .ai/mcp/server.py \
  .opencode/skills/context-engine/SKILL.md \
  .opencode/skills/azure-devops-syncer/SKILL.md \
  .opencode/skills/brd-generator/SKILL.md \
  .opencode/skills/document-classifier/SKILL.md \
  .opencode/skills/document-ingester/SKILL.md \
  .opencode/skills/pipeline-guide/SKILL.md \
  .opencode/skills/readme/SKILL.md \
  .opencode/skills/requirements-extractor/SKILL.md \
  .opencode/skills/spec-generator/SKILL.md \
  AGENTS.md \
  scripts/setup_context_engine.sh \
  scripts/refresh_sb_context.sh \
  scripts/verify_context_engine.sh \
  scripts/run_sample_task.sh \
  requirements-context.txt; do
  if [[ -f "${ROOT_DIR}/${f}" ]]; then
    copy_if_missing "${ROOT_DIR}/${f}" "${TARGET_DIR}/${f}"
  fi
done

# Create task directories
mkdir -p "${TARGET_DIR}/.ai/tasks/active" "${TARGET_DIR}/.ai/tasks/completed"

# Generate opencode.json with correct paths for the target repo
if [[ ! -f "${TARGET_DIR}/opencode.json" ]]; then
  ABS_TARGET="$(cd "${TARGET_DIR}" && pwd)"
  cat > "${TARGET_DIR}/opencode.json" <<OCEOF
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "context-engine": {
      "type": "local",
      "command": [
        "${ABS_TARGET}/.venv-context/bin/python",
        "${ABS_TARGET}/.ai/mcp/server.py"
      ],
      "enabled": true
    }
  }
}
OCEOF
  echo "  [create] ${TARGET_DIR}/opencode.json"
else
  echo "  [skip] ${TARGET_DIR}/opencode.json (already exists)"
fi

echo ""
# --- SB-derived context pull (final step, fail-soft) ---
LINK_FILE="${TARGET_DIR}/.ai/sb-project-link"
if [[ "${SKIP_SB}" -eq 1 ]]; then
  echo "[bootstrap] --no-sb passed; skipping Second Brain pull"
else
  if [[ -z "${SB_PROJECT}" && -f "${LINK_FILE}" ]]; then
    SB_PROJECT="$(head -n1 "${LINK_FILE}" | tr -d '[:space:]' || true)"
    if [[ -n "${SB_PROJECT}" ]]; then
      echo "[bootstrap] reusing SB project slug from ${LINK_FILE}: ${SB_PROJECT}"
    fi
  fi

  if [[ -z "${SB_PROJECT}" ]]; then
    if [[ -t 0 ]]; then
      printf "[bootstrap] Second Brain project slug to mirror (blank to skip): "
      read -r SB_PROJECT || true
    else
      echo "[bootstrap] no --sb-project and no link file; skipping SB pull (run scripts/refresh_sb_context.sh later)"
    fi
  fi

  if [[ -n "${SB_PROJECT}" ]]; then
    mkdir -p "${TARGET_DIR}/.ai"
    echo "${SB_PROJECT}" > "${LINK_FILE}"
    echo "[bootstrap] wrote ${LINK_FILE}"
    if bash "${ROOT_DIR}/scripts/refresh_sb_context.sh" --soft "${TARGET_DIR}"; then
      :
    else
      echo "[bootstrap] WARN refresh_sb_context.sh exited non-zero; SB pull skipped" >&2
    fi
  fi
fi

echo ""
echo "[bootstrap] Done. Next steps:"
echo "  1. cd ${TARGET_DIR}"
echo "  2. bash scripts/setup_context_engine.sh"
echo "  3. Edit .ai/context/architecture.md with your actual system description"
echo "  4. Edit .ai/context/coding_standards.md with your project conventions"
echo "  5. Edit .ai/index/config.py — add source dirs to CODE_SOURCE_DIRS"
echo "  6. python .ai/index/build_index.py"
echo "  7. python .ai/index/retrieve.py 'test query'"
echo "  8. bash scripts/verify_context_engine.sh"
echo "  9. (optional) bash scripts/refresh_sb_context.sh   # refresh SB-derived context"
