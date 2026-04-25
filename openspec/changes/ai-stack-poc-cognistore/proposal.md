## Why

CogniStore today is a strong runtime memory layer (Tauri desktop app + npm MCP server, SQLite + sqlite-vec + Ollama, typed/scoped entries, plans+tasks, `UserPromptSubmit` protocol injection). What it does **not** do:

1. **Treat Second Brain as the upstream source of truth.** The protocol that hooks inject is implicit; agents discover Second Brain through ad-hoc grep of project files. There is no enforced "consult Second Brain → consult CogniStore → consult Context Engine" hierarchy.
2. **Drive Second Brain's pipeline.** When an agent ingests a transcript or captures a runtime decision, the human still has to remember to run the Second Brain slash-commands, classify the inbox file, draft the DR, etc. CogniStore knows about every event the agent participated in but cannot promote any of it back to canonical truth.
3. **Provide humans a unified front door.** Three layers, three UIs (markdown editor for SB, IDE for Context Engine, this app for runtime memory). Aaron's Phase 2 ask: bring the human-facing surfaces together inside the CogniStore desktop app — read-mostly panels for SB and Context Engine plus a unified search bar that labels results by source.

This change wires CogniStore into the **center of the stack** while honoring Second Brain's authority. CogniStore becomes the orchestrator that drives upstream pipelines and the dashboard humans use to navigate all three layers — without becoming a new source of truth itself.

## What Changes

### Phase 1 — Hooks & Orchestration (no UI changes)

- **NEW capability `sb-orchestration-mcp`** — CogniStore exposes new MCP tools that drive Second Brain's programmatic pipeline (defined in the `ai-stack-poc-second-brain` change):
  - `secondBrain.runPipeline(project, stage?)` — shells out to Second Brain's `_tools/ingest/run-pipeline.js` and returns the resulting PR URL.
  - `secondBrain.promoteDecision(entryId, project?)` — shells out to Second Brain's `_tools/promote/from-cognistore.js`, returns PR URL.
  - `secondBrain.listProjects()` — reads Second Brain's `_graph.json` to enumerate projects.
  - `secondBrain.lookupTraceability(artifactId)` — given any SB artifact id, returns its derivation graph (upstream sources + downstream specs).
  - **Managed Second Brain clone freshness service** — auto-fetches `origin/develop` and auto-runs the SB→CogniStore sync script on app launch and before any SB-context-using operation, keeping each developer's local CogniStore DB in lockstep as coworkers push new DRs/specs to Second Brain. Coordinates with the intake-pipeline's per-session fetch+reset via the shared single-instance lock. Failure-soft: surfaces a warning banner and serves cached content rather than blocking the user.
  - All four tools resolve `~/AcuityTech/Second Brain` by default; configurable via existing CogniStore config (`secondBrainPath`).

- **NEW capability `protocol-hierarchy`** — extend the existing `UserPromptSubmit` hook to inject a layered protocol:
  - "Before answering, (1) call `getKnowledge()` against CogniStore as today; (2) if working in a repo with `.ai/mcp/server.py`, also consult `context_retrieve`; (3) if your task references a project listed in Second Brain's projects, prefer Second Brain DRs and specs over CogniStore entries when they conflict."
  - Add a `system`-typed CogniStore knowledge entry that documents the hierarchy: **Second Brain (canonical) > CogniStore (runtime mirror) > Context Engine (per-repo code-aware)**. This entry is created by a one-time install step.
  - Update `cognistore-query`, `cognistore-capture`, `cognistore-plan` skill docs to reference the hierarchy and to call out that decisions captured in CogniStore are runtime-tactical; canonical decisions live in Second Brain DRs.

- **NEW config**: `cognistore.config` gains optional fields `secondBrainPath` (default `~/AcuityTech/Second Brain`), `contextEngineRepos` (array of repo paths to surface in dashboard later), `enableSbOrchestration` (default false → opt-in).

### Phase 1.5 — Context Engine Deployment Surface

CogniStore becomes the **deployment surface** for Context Engine on new repos. Source-of-truth ownership for Context Engine code remains in `~/AcuityTech/ai-projects/` (per `ai-stack-poc-context-engine`); CogniStore vendors a pinned snapshot of the templates and exposes deploy/upgrade UX. This avoids forcing users to discover Context Engine separately while keeping the runtime (Python venv, embeddings, ChromaDB) per-repo where it belongs.

- **NEW capability `context-engine-bundle`** — vendored templates + lifecycle commands + auto-detect prompt:
  - **Vendored templates** under `cognistore/templates/context-engine/` — pinned snapshot of Context Engine's `.ai/` scaffold + `scripts/bootstrap_real_repo.sh`, `scripts/setup_context_engine.sh`, `scripts/refresh_sb_context.sh`, `requirements-context.txt`, plus a `VERSION` file pinning the snapshot to a Context Engine git SHA.
  - **NEW MCP tool `stack.init({ repoPath, sbProject? })`** — copies templates into `<repoPath>/.ai/`, runs Python venv setup, optionally pulls Second Brain–derived context when `sbProject` is provided. Idempotent: re-running on an already-bootstrapped repo no-ops with a clear message.
  - **NEW MCP tool `stack.upgrade({ repoPath })`** — re-applies the current vendored templates over an existing `.ai/`, preserving local content (decisions log, indexes, custom skills); refreshes scripts and the venv.
  - **NEW MCP tool `stack.status({ repoPath })`** — reports installed Context Engine version, last index build timestamp, drift between target repo and currently bundled version.
  - **NEW hook `ContextEngineDetect`** — runs at session start: if CWD is a git repo with no `.ai/index/` and no `.ai/.no-context-engine` opt-out marker and the session is not in CI (`CI` env var unset), prompt: "Context Engine is not set up here. Initialize now? [Y/n/never]". `never` writes the opt-out marker. Never re-prompts in the same session. Honors a `cognistore.config.contextEnginePromptDisabled` global override.
  - **Source-of-truth discipline**: vendored templates are read-only within CogniStore's repo. Edits MUST happen in `~/AcuityTech/ai-projects/` and be re-vendored via `npm run vendor:context-engine` (a script that copies + bumps the `VERSION` file). CI check rejects PRs that modify vendored files without a corresponding bump.

### Phase 2 — Unified Human Front Door (Dashboard Panels)

> **Phase 3 expansion**: a separate openspec change `ai-stack-poc-cognistore-intake-pipeline` extends Phase 2 with a PM-facing Project Workspace view (managed Second Brain clone, inbox dropzone, intake/PR-cut Copilot CLI invocation, diff review with Reject/Refine/Approve, hard guardrail against direct analysis edits). Phase 2's read-only Second Brain panel becomes a sibling of the Workspace view in that change. Read both proposals together for the full Phase 2+3 picture.

- **NEW capability `dashboard-panels`** — extend the existing Tauri dashboard (currently has stats / plans / knowledge views) with three new panels:
  - **Second Brain panel**: file-tree browser of `01-Projects/<project>/`, render the project brain + DRs + specs side-by-side as read-only markdown, "Open in editor" buttons (deep-link to user's configured editor), badge showing # of unrated drafts. Read-only in the app — authoring stays in editor + git per Aaron's mandate.
  - **Context Engine panel**: per-repo card listing index status, last build timestamp, dep-graph search box that calls the Context Engine's MCP `context_deps neighbors` tool, "Re-index" button that shells out to the repo's `.ai/index/build_index.py`. List sourced from `cognistore.config.contextEngineRepos`.
  - **Unified search bar**: queries (in parallel) CogniStore knowledge (via `getKnowledge`), Second Brain markdown bodies via filesystem ripgrep over `${secondBrainPath}/01-Projects/`, and Context Engine vector indexes for each configured repo (via `context_retrieve`). Results labeled `[SB]`, `[CS]`, `[CE]` with hover-to-see source path.
  - **Health pane**: Ollama status, sync freshness (last `cognistore-sync.js` run timestamp from CogniStore's own metadata), Context Engine indexes built status, hook injection working test.

- **MODIFIED capability `dashboard-shell`** — existing dashboard navigation gains tabs/links for the new panels. The bottom-status-bar shows the most stale of {SB sync, CE indexes} in red when older than configurable thresholds.

## Capabilities

### New Capabilities

- `sb-orchestration-mcp` — Four MCP tools (`secondBrain.*`) that drive Second Brain's pipeline scripts and surface its traceability graph to agents.
- `protocol-hierarchy` — Hook + system knowledge entry that establishes the SB > CS > CE precedence rule for AI agents.
- `context-engine-bundle` — Vendored Context Engine templates + `stack.init` / `stack.upgrade` / `stack.status` MCP tools + `ContextEngineDetect` hook with auto-prompt.
- `dashboard-panels` — Second Brain panel, Context Engine panel, unified search bar, health pane in the Tauri app.

### Modified Capabilities

- `dashboard-shell` — Existing navigation extended with new panels and a stack-wide health indicator.
- `userPromptSubmit-hook` — Existing protocol injection extended with the layered hierarchy directive.

## Impact

- **Local-only POC**: Per Aaron's decision (2026-04-23): "For now we will be testing locally, but we can propose a PR into the actual CogniStore repo when done and I'll have the conversation with Raphael." All work lives on `feature/ai-stack-poc` in the local clone at `~/AcuityTech/cognistore/`. Upstream PR happens after demo + Raphael conversation.
- **New runtime dependency**: CogniStore must know how to find a Second Brain checkout. Default path is `~/AcuityTech/Second Brain`; Phase 2 dashboard surfaces a "Second Brain not found" warning if missing.
- **shells out vs imports**: The MCP tools shell out to Second Brain's Node scripts (don't try to import them as JS modules) — this keeps CogniStore decoupled from Second Brain's evolving internal API. Stable contract is the script's CLI, not its source.
- **Dashboard render-only-for-content**: Panels render Second Brain and Context Engine *content* without modifying source files. Mutating actions (Promote, Re-index, Initialize) are explicit affordances that delegate to the owning system's normal entry points: Promote → opens a draft PR via `secondBrain.promoteDecision`; Re-index → shells out to the repo's existing `build_index.py`; Initialize → invokes `stack.init` and writes via the file-ownership matrix. The dashboard is never a source-of-truth — it is an orchestrator.
- **Backward compat**: All Phase 1 hooks and tools are opt-in via `enableSbOrchestration`. Existing CogniStore deployments without Second Brain see no behavior change.
- **License**: This change adds non-trivial code; remains under existing BSL 1.1.
- **Out of scope**:
  - Replacing CogniStore's own knowledge store with Second Brain's `_graph.json`. Two distinct stores; sync via `ai-stack-poc-second-brain`.
  - Authoring DRs from inside the CogniStore dashboard. The dashboard surfaces a "Promote this entry to a DR" button that calls the existing promotion MCP tool, which opens a Second Brain PR. Authoring still happens in editor + git.
  - Multi-user shared CogniStore. The current single-user-per-machine model continues.
- **Coordinated changes**:
  - Pairs with `ai-stack-poc-second-brain` (Second Brain exposes `run-pipeline.js` and `from-cognistore.js`).
  - Pairs with `ai-stack-poc-context-engine` (Context Engine surfaces its dep-graph for the dashboard panel).
  - See `KICKOFF.md` at `~/AcuityTech/ai-projects/ai-tooling/` for cross-repo orchestration and Phase 1/2 acceptance gates.
