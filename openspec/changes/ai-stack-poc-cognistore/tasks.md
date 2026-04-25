## 1. Foundations

- [x] 1.1 Create `openspec/AGENTS.md` and `openspec/project.md` documenting the OpenSpec workflow for this repo (mirror the ai-projects style)
- [x] 1.2 Add `secondBrainPath`, `contextEngineRepos`, `enableSbOrchestration` to the existing CogniStore config schema. Default `enableSbOrchestration: false`
- [x] 1.3 Document config surface in `CLAUDE.md` config section
- [x] 1.4 Add a feature-flagged code path so existing users see no change until they opt in

## 2. SB Orchestration MCP Tools (Phase 1)

- [ ] 2.1 Implement `secondBrain.runPipeline(project, stage?)` — Node child_process shelling out to `${secondBrainPath}/_tools/ingest/run-pipeline.js`; pipes stdout/stderr; returns parsed result `{ branch, prUrl?, manualInstructions? }`
- [ ] 2.2 Implement `secondBrain.promoteDecision(entryId, project?)` — same shape, calls `_tools/promote/from-cognistore.js`
- [ ] 2.3 Implement `secondBrain.listProjects()` — reads `${secondBrainPath}/_graph.json` (or per-project graphs) and returns project names with brain-file existence flag
- [ ] 2.4 Implement `secondBrain.lookupTraceability(artifactId)` — reads `_graph.json`, walks `derived_from` upstream and inverse-edges downstream, returns shape `{ upstream: Artifact[], downstream: Artifact[] }`
- [ ] 2.5 All four tools fail-soft when `secondBrainPath` is not configured or the directory doesn't exist (return structured error, not throw)
- [ ] 2.6 Unit tests with a fixture Second Brain checkout (small, ~3 fake projects under `tests/fixtures/second-brain/`)
- [ ] 2.7 Register all four tools with the MCP server entry point; surface in MCP capability list
- [ ] 2.8 Smoke test against the real `~/AcuityTech/Second Brain` (manual, in PR description)

## 2.5 Managed Second Brain Clone Freshness (Phase 1 / Phase 3 shared infrastructure)

- [ ] 2.5.1 Implement `SbFreshnessService` (Rust, in the Tauri backend): single in-process mutex; methods `checkOnLaunch()`, `checkBeforeUse(reason: string)`, `manualSync()`. State file at `${appDataDir}/sb-freshness-state.json`.
- [ ] 2.5.2 Wire `checkOnLaunch()` into the Tauri `setup` hook (after DB open, before window show). Show a "Syncing Second Brain context…" splash if a sync runs; suppress if fresh.
- [ ] 2.5.3 Wire `checkBeforeUse()` into the four `secondBrain.*` MCP tools and into the `getKnowledge` IPC path (only when result set contains `source:second-brain`-tagged entries; cheap to detect via tag pre-filter).
- [ ] 2.5.4 Coordination with intake-pipeline lock: if `.cognistore-intake.lock` is held, freshness skips with `intake_in_progress` (no wait — intake does its own fetch+reset).
- [ ] 2.5.5 Sync script invocation: shell out to `node ${managedClone}/_tools/sync/cognistore-sync.js` via the managed clone's bundled Node/`npm install` (handled by intake-pipeline's bootstrap flow); capture stderr separately; surface partial-failure banner if exit != 0.
- [ ] 2.5.6 Health pane wiring: render freshness state with green/yellow/red thresholds; "Sync Second Brain now" button calls `manualSync()`.
- [ ] 2.5.7 Integration test: simulate "1 new DR pushed to remote" by scripting a second clone that pushes; relaunch CogniStore; assert `getKnowledge("<topic from new DR>")` returns the new entry within the launch sequence.
- [ ] 2.5.8 Failure-mode tests: offline (fetch fails), malformed-DR (sync fails), lock contention (intake running), sync-script absent (managed clone bootstrap incomplete).

## 3. Protocol Hierarchy (Phase 1)

- [x] 3.1 Author the system-typed knowledge entry text describing the SB > CS > CE precedence rule (full text in `design.md` §System Knowledge Entry)
- [x] 3.2 Implement a one-time install step: when `enableSbOrchestration` flips to true, upsert the system knowledge entry with `type: system, scope: global, tags: [protocol-hierarchy, system, ai-stack-poc]`
- [x] 3.3 Update `UserPromptSubmit` hook injection text to reference the hierarchy and instruct: (a) call `getKnowledge()` first, (b) if `.ai/mcp/server.py` exists in CWD also call `context_retrieve`, (c) when conflicts arise, prefer Second Brain DR/spec content over CogniStore entries
- [x] 3.4 Update `cognistore-query` skill: append a section "Layer precedence" with the hierarchy
- [x] 3.5 Update `cognistore-capture` skill: add guidance "If this is a strategic decision (not tactical), capture under `scope: workspace:<project>` OR add a `project:<name>` tag so the entry is promotion-ready. Global-scope strategic decisions require operator-supplied `--project=<name>` at promotion time and cannot be auto-promoted."
- [x] 3.6 Update `cognistore-plan` skill: add guidance to consult `secondBrain.lookupTraceability` for plans that touch a project listed in Second Brain
- [x] 3.7 Existing-user migration: on next CogniStore upgrade, prompt user once "Enable AI Knowledge Stack integration? (Requires Second Brain checkout at ~/AcuityTech/Second Brain or custom path)"

## 3.5 Context Engine Bundle (Phase 1.5)

- [x] 3.5.1 Create `cognistore/templates/context-engine/` directory; vendor initial snapshot from `~/AcuityTech/ai-projects/` (`.ai/` scaffold + `scripts/bootstrap_real_repo.sh`, `scripts/setup_context_engine.sh`, `scripts/refresh_sb_context.sh`, `requirements-context.txt`)
- [x] 3.5.2 Write `templates/context-engine/VERSION` containing the upstream Context Engine git SHA at vendor time
- [x] 3.5.3 Implement `npm run vendor:context-engine` (`scripts/vendor-context-engine.js`) — copies from `CONTEXT_ENGINE_SOURCE` env var (default `~/AcuityTech/ai-projects`), updates `VERSION`, stages changes
- [x] 3.5.4 Add CI check: PRs modifying `templates/context-engine/**` without a `VERSION` change fail with a pointer to the re-vendor command
- [x] 3.5.5 Implement MCP tool `stack.init({ repoPath, sbProject? })` — copy templates, run venv setup via `child_process`, optional SB pull, return result; idempotent on already-bootstrapped repos
- [x] 3.5.6 Implement MCP tool `stack.upgrade({ repoPath })` — overwrite scripts/`.ai/index/`/`.ai/mcp/`/`.ai/skills/<context-engine>/` while preserving `decisions.log`, `.last-build`, `.ai/context/sb-derived/`
- [x] 3.5.7 Implement MCP tool `stack.status({ repoPath })` — read installed `VERSION`, compare to vendored, report drift + last build + sb-derived presence
- [x] 3.5.8 Implement `ContextEngineDetect` hook — fires once per session at start; respects `CI` env var, `.ai/.no-context-engine` opt-out marker, `cognistore.config.contextEnginePromptDisabled`; prompt "Initialize now? [Y/n/never]"; `never` writes opt-out marker
- [ ] 3.5.9 (DEFERRED — requires upstream commit in ai-projects/ai-tooling; tracked in docs/context-engine.md "Coordination Items") Update `bootstrap_real_repo.sh` in Context Engine source repo to be a thin shim that invokes `cognistore stack init` if CogniStore is on PATH; fall back to current behavior otherwise (back-compat)
- [x] 3.5.10 Documentation: README section "Context Engine deployment" + skill-doc updates so agents know about `stack.init` / `stack.status`
- [x] 3.5.11 Test `stack.init` against a tmp repo end-to-end (clean → init → assert `.ai/index/` populated → run a recorded decision → assert it appeared in CogniStore)
- [x] 3.5.12 Test `stack.upgrade` preserves local content (write fixture `decisions.log`, bump vendored version, upgrade, assert log untouched)

## 4. Dashboard — Second Brain Panel (Phase 2)

- [ ] 4.1 New Tauri view route `/second-brain` with file-tree component (use existing tree library if any; else introduce one — design.md §UI Library Choice)
- [ ] 4.2 Tree shows `01-Projects/*/` collapsed by default; expanding shows the project's `00-inbox`, `01-sources`, `02-analysis`, `03-decisions`, `04-specs` directories
- [ ] 4.3 Selecting a file renders its markdown body via the same renderer used by the existing knowledge-entry view
- [ ] 4.4 Frontmatter is rendered as a structured "Metadata" sidebar (id, type, status, derived_from with click-to-jump)
- [ ] 4.5 "Open in editor" button uses `code <path>` / `subl <path>` / configured editor command (config-driven)
- [ ] 4.6 Badge on tree node: count of files with `status: proposed` or unresolved gaps/questions
- [ ] 4.7 No write actions in this panel — strictly read-only renders
- [ ] 4.8 Empty-state when `secondBrainPath` not configured: prompt with link to settings

## 5. Dashboard — Context Engine Panel (Phase 2)

- [ ] 5.1 New Tauri view route `/context-engine`
- [ ] 5.2 Per-repo card for each entry in `cognistore.config.contextEngineRepos`. Card shows: repo name, last-index timestamp (read from `.ai/index/.last-build`), index size, # of decisions in `.ai/memory/decisions.log`
- [ ] 5.3 "Search dep-graph" input — calls Context Engine's MCP `context_deps` tool via the configured Python venv (or `.ai/mcp/server.py` direct exec); displays results as a small graph view (or text list if no graph lib)
- [ ] 5.4 "Re-index" button shells out to `<repo>/.ai/index/build_index.py`; streams stdout to a log pane in the panel; updates last-build timestamp on completion
- [ ] 5.5 "Add repo" button opens a folder picker that validates the chosen folder has `.ai/` scaffold; appends to config
- [ ] 5.6 Empty-state when `contextEngineRepos` is empty: explainer + link to bootstrap docs in `~/AcuityTech/ai-projects/ai-tooling/README.md`

## 6. Dashboard — Unified Search Bar (Phase 2)

- [ ] 6.1 Top-of-app search input that submits to a new `/search?q=` route
- [ ] 6.2 Three parallel queries: (a) existing CogniStore semantic search, (b) Second Brain markdown body via shell-out to `rg --json` filtered to `01-Projects/`, (c) per-repo `context_retrieve` invocation
- [ ] 6.3 Results page renders three sections labeled `[SB]`, `[CS]`, `[CE]` with the top 5 from each
- [ ] 6.4 Each result shows: title/path, snippet with match highlights, source label, click-to-open behavior (CS → knowledge view; SB → SB panel; CE → opens repo in configured editor at the matched file)
- [ ] 6.5 Loading states are independent — slow Context Engine results don't block CS/SB results
- [ ] 6.6 Failure handling: any of the three sources erroring shows that section's error inline, others continue

## 7. Dashboard — Health Pane (Phase 2)

- [ ] 7.1 New panel `/health` with four indicators:
  - Ollama running + model loaded (existing check)
  - Last SB→CS sync timestamp (read from CogniStore metadata; if older than configurable threshold, red)
  - For each Context Engine repo: index built + age (red if older than threshold)
  - Hook injection working: a self-test that records its own invocation timestamp and verifies it
- [ ] 7.2 Status-bar component visible from every screen showing the worst-of state across the four indicators
- [ ] 7.3 Click-through from each indicator to remediation docs

## 8. Documentation

- [ ] 8.1 Update root `README.md` with a "Three-Layer Stack Mode" section describing the optional SB/CE integration
- [ ] 8.2 Update `CLAUDE.md` with new MCP tools + skill guidance changes
- [ ] 8.3 Add `docs/ai-stack-poc-architecture.md` summarizing the layer model and link to ai-tooling KICKOFF.md
- [ ] 8.4 Screenshot the three new dashboard panels for the PR description (kept out of git)

## 9. Testing & Validation

- [ ] 9.1 MCP tool unit tests — fixture-driven (4 SB tools)
- [ ] 9.2 Hook integration test — verify the layered protocol text is injected when the flag is on
- [ ] 9.3 Dashboard panels: snapshot tests on render with fixture data
- [ ] 9.4 Manual end-to-end demo script in `docs/ai-stack-poc-demo.md`: create a transcript in SB inbox → invoke `secondBrain.runPipeline` from the agent → see PR open → review and merge → see CogniStore sync pull the new DR → see CogniStore dashboard render it under SB panel

## 10. Rollout & Open Items

- [ ] 10.1 Phase 1 acceptance: hooks + 4 MCP tools demo against real Second Brain repo
- [ ] 10.2 Phase 2 acceptance: all 4 dashboard panels working with real data on Aaron's machine
- [ ] 10.3 Open: confirm with Raphael upstream PR strategy (separate proposal will follow this POC)
- [ ] 10.4 Open: agree on telemetry surface — should the dashboard publish anonymized health metrics anywhere? (Default: no)
