# Context Engine Deployment

CogniStore is the **deployment surface** for [Context Engine](https://github.com/AcuityTech/ai-projects). Source-of-truth for Context Engine code lives in `~/AcuityTech/ai-projects/ai-tooling/`. This repo vendors a pinned snapshot of Context Engine's templates and exposes lifecycle MCP tools that bootstrap, upgrade, and inspect per-repo Context Engine installations.

## Layout

| Path | Purpose |
|---|---|
| `templates/context-engine/` | Vendored snapshot — read-only by convention |
| `templates/context-engine/VERSION` | Upstream git SHA at vendor time |
| `templates/context-engine/MANIFEST.json` | Vendored-owned vs user-owned file classification |
| `scripts/vendor-context-engine.mjs` | Re-vendor command (run via `pnpm vendor:context-engine`) |
| `apps/mcp-server/src/tools/stack.ts` | Implementation of `stackInit` / `stackUpgrade` / `stackStatus` |
| `.github/workflows/context-engine-vendoring.yml` | CI check: rejects vendored-file edits without a `VERSION` bump |

## MCP Tools

### `stackInit({ repoPath, sbProject?, skipVenv? })`

Bootstraps Context Engine into a target repo:

1. Verifies `repoPath` exists and is not already initialized (idempotent — returns `{ initialized: false, alreadyBootstrapped: true }` if `.ai/.last-build`, `.ai/index/.last-build`, or `.ai/.context-engine-version` is present).
2. Copies all vendored-owned files from `templates/context-engine/` into `repoPath/` (paths driven by `MANIFEST.json`).
3. Ensures user-owned directories exist (`.ai/memory/`, `.ai/index/`, `.ai/context/sb-derived/`, `.ai/tasks/`).
4. Marks `scripts/*.sh` executable.
5. Runs `bash scripts/setup_context_engine.sh` (skipped when `skipVenv: true`) to create `.venv-context/` and install `requirements-context.txt`.
6. If `sbProject` is provided: writes `.ai/sb-project-link` and runs `scripts/refresh_sb_context.sh --soft` to pull Second Brain–derived context.
7. Records the installed Context Engine version at `.ai/.context-engine-version`.

Returns `{ initialized, version, sbDerived, copiedPaths, errors, warnings }`.

### `stackUpgrade({ repoPath })`

Refreshes vendored-owned files in an existing installation:

- Overwrites: `scripts/*.sh`, `.ai/index/*.py`, `.ai/mcp/*.py`, vendored skill docs.
- Preserves: `.ai/memory/decisions.log`, `.ai/.last-build`, `.ai/index/.last-build`, `.ai/sb-project-link`, `.ai/.no-context-engine`, `.ai/context/sb-derived/**`.
- No-ops when the installed version matches the vendored version (`{ upgraded: false, reason: 'already-current' }`).

### `stackStatus({ repoPath })`

Reports installation state:

```json
{
  "installed": true,
  "version": "<git sha at .ai/.context-engine-version>",
  "vendoredVersion": "<git sha at templates/context-engine/VERSION>",
  "drift": false,
  "lastBuild": "2026-04-25T19:00:00.000Z",
  "sbDerivedPresent": true
}
```

## Re-Vendoring

Edit upstream first, then run:

```bash
pnpm vendor:context-engine
```

This script:

1. Resolves `CONTEXT_ENGINE_SOURCE` (defaults to `~/AcuityTech/ai-projects/ai-tooling`).
2. Wipes `templates/context-engine/` (preserving `VERSION`, `MANIFEST.json`).
3. Copies the file list defined in the script back into place.
4. Rewrites `MANIFEST.json` and `VERSION` (with the upstream git SHA).
5. Stages all changes via `git add`.

Flags:

- `--dry-run` — show what would be copied; make no changes.
- `--no-stage` — skip the `git add` step.

CI (`.github/workflows/context-engine-vendoring.yml`) rejects PRs that modify any file under `templates/context-engine/**` without bumping `templates/context-engine/VERSION` — this enforces the "edit upstream + re-vendor" workflow.

## Auto-Detect Hook

The `cognistore-query` skill (Claude Code + Copilot variants) ships a `context-engine-detect.sh` user-prompt hook. On session start in any git repo without `.ai/index/`, it injects a system message that asks the agent to prompt the user with:

> Initialize Context Engine here? [Y/n/never]

- `Y` → call `stackInit({ repoPath })`
- `n` → skip for this session only
- `never` → write `.ai/.no-context-engine` to suppress permanently

The hook respects:

| Suppressor | Effect |
|---|---|
| `CI` env var (any non-empty value) | Skip |
| `COGNISTORE_CONTEXT_ENGINE_PROMPT_DISABLED=1` | Skip |
| `~/.cognistore/config.json` → `contextEnginePromptDisabled: true` | Skip |
| `.ai/.no-context-engine` in CWD | Skip |
| `.ai/index/` exists in CWD | Skip (already initialized) |
| Per-session marker (`$TMPDIR/.cognistore-ce-detect-<ppid>`) | Skip duplicate prompts in same session |

## Decisions Bridge: `/ipc/addKnowledge`

The vendored Context Engine ships `summarize.py record`, which POSTs each recorded decision to CogniStore. By default it targets `${COGNISTORE_IPC_URL:-http://localhost:7321/ipc/addKnowledge}`.

The CogniStore dashboard server (`apps/dashboard/server/index.ts`) exposes both:

- `POST /api/knowledge` — canonical route used by the dashboard UI
- `POST /ipc/addKnowledge` — alias with the same handler shape, kept so the upstream bridge default URL works without per-repo config

Both routes accept a `CreateKnowledgeInput` body and return the persisted entry.

If you prefer to point the bridge at the canonical route, add this to `<repo>/summarize.config.toml`:

```toml
[cognistore]
enabled = true
ipc_url = "http://localhost:7321/api/knowledge"
```

…or set the `COGNISTORE_IPC_URL` env var.

## Coordination Items

The upstream `bootstrap_real_repo.sh` (in `~/AcuityTech/ai-projects/ai-tooling/scripts/`) is intentionally **not** modified by the cognistore POC — that change requires a follow-up commit in `ai-projects` (task 3.5.9 in the openspec proposal). The plan: turn `bootstrap_real_repo.sh` into a thin shim that delegates to `cognistore stack init` when CogniStore is on PATH, falling back to its current local-copy logic otherwise.
