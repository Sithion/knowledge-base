# intake-testing-plan

Documented, executable test plan that the agent (or Aaron) follows after the intake-pipeline specs land. Treated as a deliverable of this change, not a side note. Aaron explicitly requested: "I do have the production version of cognistore running right now so you can make a note in the specs about that and I can close the app if need be before running a local modified version."

## ADDED Requirements

### Requirement: Pre-flight — stop production CogniStore

Before any local intake-pipeline build is started, the production CogniStore desktop app SHALL be stopped. The local dev build holds the same SQLite database lock at `${appDataDir}/cognistore.db` and will fail to start if production is running.

The pre-flight SHALL also confirm:

- `pgrep -f cognistore` returns no matches (or the user manually quits via menu/dock).
- The managed Second Brain workspace dir does not exist yet, OR if it exists, it is in a clean state (`git status` reports clean working tree).
- Aaron's personal Second Brain clone at `~/AcuityTech/Second Brain` is not modified by this test (the managed clone is separate).

#### Scenario: Stop production before dev build

- **GIVEN** the published CogniStore app is running
- **WHEN** the test plan starts
- **THEN** the agent SHALL pause and instruct: "Quit the production CogniStore app from the macOS menu bar (Cmd+Q on the focused window) before continuing."
- **AND** SHALL verify with `pgrep -f cognistore` returning empty
- **AND** SHALL NOT proceed until verified

### Requirement: Local build path

The agent SHALL attempt to build CogniStore from the `feature/ai-stack-poc` branch locally:

```sh
cd ~/AcuityTech/cognistore
git status -sb  # confirm on feature/ai-stack-poc
pnpm install                                  # bootstrap workspaces
pnpm --filter @cognistore/dashboard tauri:dev # opens dev build
```

If the build succeeds, the dev app launches and the agent continues with the end-to-end test scenarios.

If the build fails (Tauri toolchain missing, dependency conflict, Rust compiler issue, etc.), the agent SHALL:

1. Capture the full error output.
2. Attempt one round of automated remediation (e.g., install missing toolchain via documented commands).
3. If still blocked, fall back to the **guided manual test path** (see Requirement: Guided manual fallback).

#### Scenario: Build succeeds, dev app launches

- **WHEN** `pnpm --filter @cognistore/dashboard tauri:dev` completes
- **THEN** the dev CogniStore window opens
- **AND** the agent continues with Test Scenario 1

#### Scenario: Build fails, fall back to manual

- **GIVEN** `pnpm --filter @cognistore/dashboard tauri:dev` fails with a Rust toolchain error
- **WHEN** automated remediation does not resolve it
- **THEN** the agent SHALL switch to guided manual test path
- **AND** SHALL document the build failure in the test session notes

### Requirement: Test Scenario 1 — Reject path against sample-bot

Validates inbox staging, Phase A invocation, JSONL streaming, diff rendering, and Reject path **without opening any PR**.

Steps:

1. Open Project Workspace view.
2. Run Setup Diagnostics; confirm all 5 probes pass.
3. Pick project: `sample-bot`.
4. Drop a small synthetic file into the inbox: `test-input.md` containing `# Test Intake\n\nSynthetic content for testing.\n`.
5. Click Process Inbox.
6. Watch the live transcript — confirm at minimum: `tool_call`, `tool_result`, `text_delta`, `final_message` events render visibly.
7. Confirm Phase A completes within 10 minutes.
8. Confirm the diff renders in the review panel (may be small or empty depending on agent behavior on synthetic input).
9. Click Reject.
10. Confirm: branch deleted, staging dir moved to `<auditDir>/rejected-files/`, session marked rejected in history.

#### Scenario: Reject path completes end-to-end

- **WHEN** the user follows steps 1-10 above
- **THEN** all assertions pass
- **AND** no PR is opened against any Second Brain branch

### Requirement: Test Scenario 2 — Refine path

Validates that Refine keeps the branch and accumulates work.

Steps:

1. Start a fresh intake session against `sample-bot`.
2. Drop `iteration-1.md` containing some content. Click Process Inbox.
3. After Phase A completes and diff renders, click Refine.
4. Drop `iteration-2.md` containing additional content. Click Process Inbox again.
5. Confirm the new diff includes changes from BOTH iterations on the same branch.
6. Click Reject to clean up.

#### Scenario: Refine accumulates without reset

- **WHEN** the user follows steps above
- **THEN** the branch is the same across both iterations (no `git checkout -b` between iterations)
- **AND** the second diff is a superset of the first

### Requirement: Test Scenario 3 — Approve path against throwaway branch

Validates Phase B PR creation **without polluting Second Brain `develop`**. The test SHALL be run against a throwaway base branch in Second Brain (NOT `develop`).

Steps:

1. In the managed Second Brain workspace, manually create a throwaway base: `git push origin develop:test/intake-pipeline-poc-base` (or the agent does this via `gh api`).
2. Temporarily configure `intakePipeline.prCutBaseBranch = "test/intake-pipeline-poc-base"` in the dev app's config.
3. Run a fresh intake session against `sample-bot` with a small synthetic file.
4. After Phase A, click Approve.
5. Confirm Phase B runs, opens a draft PR against `test/intake-pipeline-poc-base`, surfaces the PR URL.
6. Open the PR in the browser, confirm: title and body match the templated format, branch name is `sb-intake/sample-bot/<timestamp>`, the diff is identical to what was reviewed.
7. Close the PR (do not merge), delete the throwaway branch.

#### Scenario: Approve path opens draft PR against test base

- **WHEN** the user follows steps above
- **THEN** a draft PR is opened against `test/intake-pipeline-poc-base` (NOT `develop`)
- **AND** the PR URL is captured in the audit log
- **AND** Second Brain `develop` is unaffected

### Requirement: Test Scenario 4 — First-run setup gating

Validates that intake is gated when prerequisites are missing.

Steps:

1. Temporarily mask `copilot` in the dev app's spawn env (e.g., add a sentinel env var that the spawn helper checks and returns "command not found" for).
2. Open Project Workspace view.
3. Confirm: Setup Required banner appears, Process Inbox is disabled with the right tooltip.
4. Open Diagnostics modal; confirm `copilot --version` shows ❌ with macOS install snippet visible.
5. Remove the mask; click Re-check.
6. Confirm all probes pass; Process Inbox re-enables.

#### Scenario: Setup gate engages and lifts correctly

- **WHEN** the user follows steps above
- **THEN** intake is correctly gated when `copilot` is unavailable and unblocked when restored
- **AND** other app features (knowledge query, plans) remain functional throughout

### Requirement: Test Scenario 5 — Managed-clone freshness on launch and pre-use

Validates the freshness service introduced by `ai-stack-poc-cognistore/specs/sb-orchestration-mcp` ("Managed Second Brain clone freshness check on launch and before SB-context use"). This scenario uses the same managed clone the intake pipeline uses, so it MUST run against a throwaway base configuration (`intakePipeline.prCutBaseBranch` set to a test branch) to avoid polluting real SB `develop`.

Steps:

1. Stop production CogniStore (Test Scenario preflight). Launch dev build.
2. Note `${appDataDir}/sb-freshness-state.json` baseline values: `lastFetchAt`, `lastSyncAt`, `lastDevelopSha`.
3. From a separate terminal, in a second clone of Second Brain on `feature/intake-test`, push a new DR to `origin/develop` (or to a configured test branch acting as `develop` for this run): create file `01-Projects/sample-bot/03-decisions/DR-999-freshness-test.md` with valid frontmatter (`id: DR-999-freshness-test`, `derived_from: []`, `project: sample-bot`), commit, push.
4. Trigger a SB-context-using operation in CogniStore: open the Second Brain panel, OR call `secondBrain.lookupTraceability("DR-999-freshness-test")` via MCP, OR run `getKnowledge("freshness test DR")`.
5. Observe: a "Syncing Second Brain context (1 new artifact)…" toast/banner appears; `sb-freshness-state.json` updates `lastSyncAt`, `lastDevelopSha`; a subsequent `getKnowledge` for the new DR returns it.
6. Quit dev CogniStore and relaunch (cold start). Confirm freshness check completes silently (no toast) because the clone is already up-to-date.
7. Push a second DR (`DR-1000-freshness-test`); this time relaunch CogniStore (cold start). Confirm the **launch** trigger detects the staleness, runs sync before window-show or before SB panel renders, and the new DR is queryable on first interaction.
8. Lock-contention check: start a Phase 3 intake session and, while it runs, call `secondBrain.listProjects()`. Confirm the freshness service skips with `intake_in_progress` (debug log) and the call returns immediately against current DB.
9. Network-failure check: disconnect Wi-Fi, relaunch CogniStore. Confirm a non-blocking warning banner appears ("Second Brain context may be stale: <reason>"), `sb-freshness-state.json` records `lastError`, and `getKnowledge` calls still return cached results.
10. Reconnect; trigger any SB-context use. Confirm freshness retries and clears the warning.

Pass criteria: All four trigger paths (launch, MCP tool, knowledge query touching SB-tagged content, post-failure retry) cause exactly one fetch+sync per stale-detection event; mutex prevents redundant parallel runs; failure modes never block the user.

#### Scenario: Cold start with stale clone runs sync before first SB query

- **WHEN** Aaron quits and relaunches CogniStore after a coworker pushes a new DR
- **THEN** the launch hook fast-forwards the managed clone, runs `cognistore-sync.js`, and the new DR is queryable on the first `getKnowledge` call without any manual action

#### Scenario: Pre-use trigger fires for SB-context use after a remote push

- **WHEN** the app is already running and a new DR is pushed mid-session
- **THEN** the next `secondBrain.*` MCP call OR `getKnowledge` query touching SB content triggers the freshness check, surfaces a brief "Syncing…" toast, and resolves with the updated context

#### Scenario: Intake-in-progress skips freshness

- **WHEN** an intake session holds `.cognistore-intake.lock` and another caller triggers a SB-context use
- **THEN** the freshness service skips with `intake_in_progress`, the caller proceeds against current DB, and intake's own fetch+reset is the canonical refresh

#### Scenario: Network failure surfaces warning, doesn't block

- **WHEN** `git fetch` fails (offline)
- **THEN** a non-blocking warning banner appears, cached SB content remains queryable, `sb-freshness-state.json` records the error, and the next trigger retries

### Requirement: Guided manual fallback

If the local CogniStore build is blocked (Tauri toolchain, dependency conflicts, Rust issues), the agent SHALL guide Aaron through manual terminal-based steps that simulate the same end-to-end flow:

1. Manually clone Second Brain to a throwaway dir: `gh repo clone <url> /tmp/sb-intake-test`.
2. Manually create an inbox staging dir: `mkdir -p /tmp/sb-intake-test/00-Inbox/sample-bot/manual-test-1`.
3. Drop a test file into staging: `echo "# Test" > /tmp/sb-intake-test/00-Inbox/sample-bot/manual-test-1/test.md`.
4. Manually invoke Phase A: `cd /tmp/sb-intake-test && copilot -p "<rendered intake prompt>" --agent mojito:second-brain --add-dir /tmp/sb-intake-test --allow-all-tools --no-ask-user --output-format json --share /tmp/sb-intake-test-session.md`.
5. Watch the JSONL stream in the terminal; confirm the agent works on the staged file.
6. After completion: `git diff develop` to see the changes; manually run `git branch -D` to clean up.

The manual fallback SHALL be executed by the agent (with the user watching) so the user has a verified record of the prerequisite tooling working end-to-end. The agent SHALL document the fallback execution in a session note.

#### Scenario: Manual fallback validates the underlying flow

- **GIVEN** the local CogniStore build is blocked
- **WHEN** the agent runs the guided manual fallback
- **THEN** the user sees the agent successfully invoke the same `copilot --agent mojito:second-brain` flow that the dev build would have invoked
- **AND** has confidence that the Phase A invariants work, even if the UI integration is not yet exercisable

### Requirement: Test session notes

After test execution (whether via local build or manual fallback), the agent SHALL produce a brief session notes document at `~/Downloads/intake-pipeline-test-session-<utc-iso-timestamp>.md` containing:

- Pre-flight outcome (production app stopped, prereqs verified)
- Build outcome (success / failure with reason)
- Per-scenario outcome with pass/fail + observations
- Any deviations from spec encountered
- Recommended follow-ups (issues to file, spec adjustments to consider)

This document is the artifact Aaron shares with the team to confirm the POC is exercisable.

#### Scenario: Session notes generated

- **WHEN** test execution completes (success or failure)
- **THEN** `~/Downloads/intake-pipeline-test-session-<timestamp>.md` exists
- **AND** contains all five sections above
