## ADDED Requirements

### Requirement: secondBrain.runPipeline MCP tool
The system SHALL expose an MCP tool `secondBrain.runPipeline(project, stage?)` that drives Second Brain's programmatic pipeline by shelling out to `${secondBrainPath}/_tools/ingest/run-pipeline.js`.

#### Scenario: Tool invoked with valid project and no stage
- **WHEN** an agent calls `secondBrain.runPipeline("cortex")` and `${secondBrainPath}` exists
- **THEN** the system SHALL spawn `node _tools/ingest/run-pipeline.js cortex`, capture stdout/stderr, and return `{ branch: "feat/sb-ingest-cortex-...", prUrl: "https://..." }` on success

#### Scenario: Tool invoked with a specific stage
- **WHEN** an agent calls `secondBrain.runPipeline("cortex", "intake")`
- **THEN** the system SHALL pass `--stage=intake` to the script

#### Scenario: secondBrainPath not configured
- **WHEN** the tool is called and `secondBrainPath` is absent or points to a missing directory
- **THEN** the tool SHALL return a structured error `{ error: "second_brain_not_configured", details: "..." }` and SHALL NOT throw

#### Scenario: gh CLI unavailable
- **WHEN** the script runs successfully but cannot open a PR
- **THEN** the tool SHALL return `{ branch: "...", manualInstructions: "..." }`

### Requirement: secondBrain.promoteDecision MCP tool
The system SHALL expose `secondBrain.promoteDecision(entryId, project?)` that promotes a CogniStore decision entry to a Second Brain DR draft.

#### Scenario: Workspace-scoped entry promoted
- **WHEN** an agent calls `secondBrain.promoteDecision("abc-123")` for an entry whose scope is `workspace:digital-kanban`
- **THEN** the system SHALL shell out to `_tools/promote/from-cognistore.js abc-123 --project=digital-kanban` and return the resulting PR URL

#### Scenario: Global-scoped entry without project hint
- **WHEN** an agent calls `secondBrain.promoteDecision("abc-123")` for a `scope: global` entry without supplying `project`
- **THEN** the system SHALL return a structured error `{ error: "project_required_for_global_entry", availableProjects: [...] }` so the caller can re-invoke with a choice

#### Scenario: Entry not of type decision
- **WHEN** the tool is called for an entry whose `type` is `pattern` or `gotcha` (not `decision`)
- **THEN** the tool SHALL refuse with `{ error: "only_decisions_can_be_promoted" }` and SHALL NOT shell out

### Requirement: secondBrain.listProjects MCP tool
The system SHALL expose `secondBrain.listProjects()` that enumerates all projects under Second Brain's `01-Projects/`.

#### Scenario: Tool called against configured Second Brain
- **WHEN** an agent calls `secondBrain.listProjects()`
- **THEN** the system SHALL read `${secondBrainPath}/_graph.json` and return a list of `{ name, path, brainExists }` for each project

#### Scenario: _graph.json missing
- **WHEN** `_graph.json` does not exist (Second Brain hasn't been backfilled yet)
- **THEN** the tool SHALL fall back to filesystem scan of `01-Projects/*/` and emit a warning `{ warning: "graph_not_built_falling_back_to_filesystem" }`

### Requirement: secondBrain.lookupTraceability MCP tool
The system SHALL expose `secondBrain.lookupTraceability(artifactId)` that returns the upstream and downstream artifacts in Second Brain's traceability graph for a given id.

#### Scenario: DR id with sources upstream and specs downstream
- **WHEN** an agent calls `secondBrain.lookupTraceability("DR-007-front-end-scope-guard")`
- **THEN** the system SHALL return `{ upstream: [{ id, type, project, path }, ...], downstream: [{...}], notFound: false }`

#### Scenario: Unknown id
- **WHEN** the artifact id does not appear in `_graph.json`
- **THEN** the tool SHALL return `{ upstream: [], downstream: [], notFound: true }`

#### Scenario: Cross-project derivation
- **WHEN** the artifact derives from sources in a different project
- **THEN** results SHALL include those cross-project artifacts with their own `project` field set correctly

### Requirement: Managed Second Brain clone freshness check on launch and before SB-context use

CogniStore SHALL maintain a managed Second Brain clone at `${appDataDir}/second-brain-managed/` (introduced by the intake-pipeline change). The system SHALL keep this clone — and its derived knowledge in the CogniStore database — in lockstep with `origin/develop` of Second Brain by performing an automatic freshness check at two trigger points:

1. **App launch** — once per CogniStore process startup, after the database opens but before any UI surface that exposes Second Brain content renders or any MCP tool that reads SB content responds.
2. **Before each SB-context-using operation** — including (a) all four `secondBrain.*` MCP tools defined above, (b) any `getKnowledge` query whose result set contains entries tagged `source:second-brain`, and (c) the start of any intake-pipeline session.

The freshness check SHALL:

1. Run `git -C ${managedClone} fetch --quiet origin develop` with a 10-second network timeout.
2. Compute `git -C ${managedClone} rev-list --count develop..origin/develop`.
3. If the count is `0`, mark the clone fresh and proceed.
4. If the count is `> 0`, the clone is stale. Run `git -C ${managedClone} checkout develop && git -C ${managedClone} reset --hard origin/develop`, then immediately invoke the Second Brain sync script (`node ${managedClone}/_tools/sync/cognistore-sync.js`, defined by `ai-stack-poc-second-brain/scheduled-sync`) to upsert the new artifacts into CogniStore's database.
5. Persist the result to `${appDataDir}/sb-freshness-state.json` as `{ lastFetchAt: <ISO>, lastSyncAt: <ISO>, lastDevelopSha: <sha>, behindCountAtLastFetch: <n> }`.

If the freshness check is **already in progress** (mutex held) when a second trigger fires, the second caller SHALL wait on the in-flight check rather than starting a parallel one.

If the freshness check **fails** at any step (network error, lock contention with intake, sync script error, etc.), CogniStore SHALL:

- NOT block the user from continuing — surface a non-blocking warning banner ("Second Brain context may be stale: <reason>") and serve the existing knowledge.
- Persist the failure to `sb-freshness-state.json` as `{ lastError, lastErrorAt }`.
- Retry on the next trigger (no exponential backoff for the POC; revisit if it generates noise).

The freshness check SHALL coordinate with the intake-pipeline's per-session fetch+reset (intake-pipeline/spec.md §"Managed Second Brain clone bootstrap"). When intake holds the `.cognistore-intake.lock`, the freshness check SHALL skip with reason `intake_in_progress` rather than wait, because the intake session itself does an equivalent fetch+reset before its own work.

The freshness check SHALL NOT trigger if the user has uncommitted changes in the managed clone (unexpected state — surface "Reset workspace" affordance instead).

#### Scenario: Launch with up-to-date clone
- **WHEN** CogniStore launches and `git rev-list --count develop..origin/develop` returns `0`
- **THEN** the freshness check completes silently in under 2 seconds, `sb-freshness-state.json` updates `lastFetchAt`, and no sync runs

#### Scenario: Launch with clone behind develop
- **WHEN** CogniStore launches and the count returns `5`
- **THEN** the system fast-forwards `develop`, runs `cognistore-sync.js`, and only then renders the Second Brain dashboard panel
- **AND** the dashboard panel briefly shows a "Syncing Second Brain context (5 new artifacts)…" toast

#### Scenario: getKnowledge query during pending intake
- **WHEN** an agent calls `getKnowledge("user permissions design")` while an intake session holds the lock
- **THEN** the freshness check skips with `intake_in_progress`, the query returns immediately against current DB content, and a debug-level log records the skip

#### Scenario: Network unavailable at launch
- **WHEN** CogniStore launches offline and `git fetch` times out
- **THEN** the freshness check records the error to `sb-freshness-state.json`, surfaces a non-blocking warning, and CogniStore continues to serve cached SB content from its DB

#### Scenario: Sync script fails after successful fetch
- **WHEN** `git fetch && reset --hard` succeeds but `cognistore-sync.js` exits non-zero (e.g., malformed frontmatter in a new DR)
- **THEN** the managed clone is up-to-date but CogniStore's DB lags; the warning banner says "Second Brain context partially synced; <N> artifacts pending. See diagnostics."
- **AND** the next freshness trigger retries the sync against the same up-to-date worktree

#### Scenario: Two MCP tools called in rapid succession
- **WHEN** an agent calls `secondBrain.listProjects()` and `secondBrain.lookupTraceability("DR-007")` within 100ms
- **THEN** the second call awaits the in-flight freshness check (mutex) rather than triggering a redundant fetch+sync

### Requirement: Freshness state surfaced in dashboard health pane
The Health pane SHALL render the freshness state from `sb-freshness-state.json`:

- Green: `lastSyncAt` within configurable threshold (default 24h) AND `lastError` absent.
- Yellow: `lastSyncAt` older than threshold OR last freshness check skipped due to lock contention more than once consecutively.
- Red: `lastError` present from the most recent attempt.

The Health pane SHALL provide a "Sync Second Brain now" button that triggers an out-of-band freshness check and disables until completion.

#### Scenario: User clicks "Sync Second Brain now"
- **WHEN** the user clicks the button
- **THEN** the system runs the freshness flow on demand, the button shows a spinner, and on completion the indicator turns green and a toast confirms "Second Brain synced (N new artifacts)"
