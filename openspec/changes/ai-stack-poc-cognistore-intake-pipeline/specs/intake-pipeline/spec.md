# intake-pipeline

End-to-end inbox-to-PR flow for a single Second Brain project. Allows a non-developer to drop files, run the existing `mojito:second-brain` Copilot CLI agent against a CogniStore-managed clone, review the resulting diff, and open a draft PR back to Second Brain `develop` — all from the CogniStore desktop UI.

## ADDED Requirements

### Requirement: Managed Second Brain clone

CogniStore SHALL maintain a CogniStore-owned working clone of the Second Brain repository at `${appDataDir}/second-brain-workspace/` (per OS conventions). This clone is **distinct from the user's personal clone** at `~/AcuityTech/Second Brain/`.

The managed clone SHALL be created on first use via `git clone <intakePipeline.secondBrainRepoUrl> <intakePipeline.workspaceDir>` (plain `git`, not `gh repo clone`, so first-run does not require a working `gh auth` — `gh` is only needed at PR cut in Phase B).

Before every intake session, CogniStore SHALL execute `git fetch origin develop` followed by `git checkout develop && git reset --hard origin/develop && git checkout -b sb-intake/<project>/<utc-iso-timestamp-no-colons>`. If the managed clone has uncommitted changes for any reason, CogniStore SHALL refuse to proceed and surface a "Reset workspace" affordance that hard-resets to `origin/develop`.

The user's personal clone SHALL never be read or modified by the intake pipeline.

The managed clone SHALL also serve as the substrate for the broader CogniStore freshness flow defined in `ai-stack-poc-cognistore/specs/sb-orchestration-mcp` ("Managed Second Brain clone freshness check on launch and before SB-context use"). The intake-pipeline's per-session fetch+reset and the freshness service's launch/before-use checks share the same physical clone but coordinate via the single-instance lock: when intake holds the lock, the freshness service skips with `intake_in_progress` to avoid contention (intake's own fetch+reset is equivalent).

#### Scenario: First-run clones the workspace

- **GIVEN** a fresh install with no `${appDataDir}/second-brain-workspace/`
- **AND** `intakePipeline.secondBrainRepoUrl` configured
- **WHEN** the user opens the Project Workspace view
- **THEN** CogniStore runs `gh repo clone <url> <workspaceDir>` and surfaces progress
- **AND** the project picker populates from `01-Projects/*/` after clone completes

#### Scenario: Subsequent runs fetch and reset

- **GIVEN** an existing managed clone
- **WHEN** the user clicks Process Inbox to start a new session
- **THEN** CogniStore runs `git fetch origin develop`
- **AND** creates a fresh `sb-intake/<project>/<timestamp>` branch from `origin/develop`

#### Scenario: Stale uncommitted changes block intake

- **GIVEN** the managed clone has uncommitted changes (corrupted state)
- **WHEN** the user attempts to start an intake session
- **THEN** CogniStore SHALL refuse and surface a "Reset workspace" affordance
- **AND** intake SHALL NOT proceed until the workspace is reset

### Requirement: Project picker sourced from managed clone

The project picker SHALL enumerate `${managedClone}/01-Projects/*/` directories that contain an `AGENTS.md` file. Each entry SHALL display the directory slug as the canonical identifier and (if present) a human-readable display name parsed from the project's brain file.

The picker SHALL include a "+ New Project" affordance that scaffolds a new project via the `mojito:second-brain` agent (see Phase B PR Cut requirement) with a small form (slug validated against `^[a-z0-9-]+$`, display name, one-line description).

#### Scenario: Picker lists existing projects

- **GIVEN** managed clone has `01-Projects/sample-bot/AGENTS.md`, `01-Projects/cortex/AGENTS.md`
- **WHEN** the user opens the Project Workspace view
- **THEN** the picker shows `sample-bot` and `cortex` (and any other projects with `AGENTS.md`)

#### Scenario: New project flow opens scaffold PR

- **WHEN** the user clicks "+ New Project" with slug `widget-portal` and description "Portal for managing widgets"
- **THEN** CogniStore spawns `copilot --agent mojito:second-brain` with a scaffold prompt
- **AND** on completion, runs Phase B PR Cut to open a draft PR
- **AND** surfaces the PR URL to the user

### Requirement: Inbox staging directory per session

When the user starts an intake session for project `<project>`, CogniStore SHALL create a session-scoped staging directory at `${managedClone}/00-Inbox/<project>/<sessionId>/`. The user's drag-and-drop files SHALL be **copied** (not moved) into this directory.

CogniStore SHALL validate file extensions against the supported document set (`.docx`, `.xlsx`, `.pptx`, `.pdf`, `.png`, `.jpg`, `.jpeg`, `.tiff`, `.eml`, `.msg`, `.html`, `.md`, `.txt`). Unsupported files SHALL be rejected with a UI error and not added to staging.

#### Scenario: Files copied to per-session staging

- **GIVEN** an active intake session `abc123` for project `sample-bot`
- **WHEN** the user drops `transcript.docx` and `screenshot.png` onto the dropzone
- **THEN** both files appear at `${managedClone}/00-Inbox/sample-bot/abc123/transcript.docx` and `.../screenshot.png`
- **AND** the original files at the source location are unchanged

#### Scenario: Unsupported extension rejected

- **WHEN** the user drops `notes.zip`
- **THEN** the file is NOT copied
- **AND** the UI shows an error: "Unsupported file type: .zip. Supported: .docx, .xlsx, .pptx, .pdf, .png, .jpg, .jpeg, .tiff, .eml, .msg, .html, .md, .txt"

### Requirement: Single-instance lock for managed clone

CogniStore SHALL acquire an exclusive OS-level file lock on `${managedClone}/.cognistore-intake.lock` before any operation that mutates the managed clone (clone bootstrap, fetch/reset, branch create/delete, staging dir writes, agent invocation, PR cut).

If the lock cannot be acquired within 2 seconds, CogniStore SHALL refuse to start an intake session and surface "Another CogniStore instance is using the managed clone. Close the other instance to continue."

The lock SHALL be implemented via `flock(2)` on macOS/Linux and `LockFileEx` on Windows (via the `fs2` Rust crate or equivalent), and SHALL be released on process exit (including crash) by OS reclamation.

This is a POC-level guardrail for the **single-machine, single-user** scenario. Multi-PM concurrency is explicitly out of scope.

#### Scenario: Second app instance refuses intake

- **GIVEN** instance A holds the lock and is mid-intake
- **WHEN** instance B opens the Project Workspace view
- **THEN** instance B SHALL surface "Another CogniStore instance is using the managed clone"
- **AND** instance B's Process Inbox button SHALL be disabled
- **AND** instance B's other features SHALL remain functional

### Requirement: Base-branch drift detection

The first time a session creates its `sb-intake/...` branch, CogniStore SHALL record the SHA of `origin/develop` at that moment as `metadata.baseSha` in the session record.

Before invoking Phase B (Approve), CogniStore SHALL re-run `git fetch origin develop` and compare `origin/develop` to `metadata.baseSha`. If `origin/develop` has advanced:

1. CogniStore SHALL refresh the diff view to show the diff against the **new** `origin/develop`.
2. CogniStore SHALL surface a banner: "`develop` advanced by N commits since intake started. Review the refreshed diff before approving."
3. The Approve button SHALL be temporarily disabled until the user clicks "I've reviewed the refreshed diff."
4. Phase B's `gh pr create --base <prCutBaseBranch>` SHALL still target the configured base; the rebase strategy is to leave `develop` to merge-time conflict resolution (POC-acceptable).

#### Scenario: Develop advances mid-session

- **GIVEN** intake started at base SHA `abc123`
- **AND** during review, `origin/develop` advanced to `def456`
- **WHEN** the user clicks Approve
- **THEN** CogniStore re-fetches `origin/develop`, detects drift
- **AND** refreshes the diff view
- **AND** surfaces a banner requiring explicit re-acknowledgment
- **AND** Approve is gated until acknowledgment

### Requirement: Configurable PR-cut base branch

CogniStore SHALL expose `intakePipeline.prCutBaseBranch` (default `develop`) controlling the `--base` argument of Phase B's `gh pr create`.

This config exists primarily so end-to-end testing can target a throwaway base branch (`test/intake-pipeline-poc-base`) without risking real `develop` PRs.

The Phase B prompt template SHALL receive this value as a templated variable; it SHALL NOT be hardcoded in the prompt.

#### Scenario: Test config retargets PR base

- **GIVEN** `intakePipeline.prCutBaseBranch = test/intake-pipeline-poc-base`
- **WHEN** Phase B runs
- **THEN** the resulting PR is opened against `test/intake-pipeline-poc-base`
- **AND** the audit log records that base branch

### Requirement: Phase A — Intake & Analysis agent invocation

When the user clicks **Process Inbox**, CogniStore SHALL spawn `copilot` CLI with the following invariants:

- `--agent mojito:second-brain`
- `--output-format json`
- `--allow-all-tools`
- `--no-ask-user`
- `--add-dir <managedClone>` and `--add-dir <stagingDir>` (no broader path access)
- `--model <intakePipeline.intakeModel>`
- `--share <auditDir>/copilot-session.md`
- `-p <rendered intake prompt>` from `cognistore/templates/intake-prompt.md`

The intake prompt SHALL instruct the agent to follow standard `mojito:second-brain` intake flow on the staged files, classify them, extract requirements, update analysis, draft DRs, but **MUST NOT commit, push, or open any PR**. The prompt SHALL state this constraint explicitly.

While the subprocess runs, CogniStore SHALL parse stdout line-by-line as JSONL and emit Tauri events for live transcript rendering.

On exit, CogniStore SHALL compute `git diff origin/develop...HEAD` in the managed clone, persist to `<auditDir>/diff.patch`, and emit `intake-phase-a-complete` with `{sessionId, exitCode, diffPath, diffStat}`.

#### Scenario: Successful intake produces diff

- **GIVEN** staging dir contains a transcript file
- **WHEN** the user clicks Process Inbox
- **THEN** CogniStore spawns `copilot` with the invariants above
- **AND** the UI streams agent transcript events live
- **AND** on agent exit code 0, the diff is rendered in the review panel

#### Scenario: Intake timeout aborts subprocess

- **GIVEN** `intakePipeline.intakeTimeoutSeconds = 600`
- **WHEN** the agent does not exit within 600 seconds
- **THEN** CogniStore SHALL send SIGTERM to the child process group
- **AND** if not exited within 5 seconds, SHALL send SIGKILL
- **AND** SHALL surface a timeout error to the UI with the partial transcript

### Requirement: Phase A post-run invariant audit

After Phase A's `copilot` subprocess exits, CogniStore SHALL audit the managed clone's state and reject the run if any of the following invariants were violated:

1. **No new commits** on the intake branch beyond `metadata.baseSha`. Phase A is contractually a "working tree mutations only" phase. If the agent committed (`git rev-list metadata.baseSha..HEAD` is non-empty), CogniStore SHALL surface "Phase A violated commit invariant — agent committed during intake. Roll back?" with a one-click `git reset --soft metadata.baseSha` recovery action.
2. **No remote pushes** were initiated by the agent. CogniStore SHALL inspect `origin/<branch>` via `git ls-remote` and warn if a remote ref now exists for the intake branch.
3. **No writes outside `--add-dir` scope**. Copilot CLI is expected to enforce this, but CogniStore SHALL additionally verify by inspecting the diff: any path outside `${managedClone}` is a hard fail.

This is **defense in depth** — the headless-agent-contract specifies these constraints in the prompt, but enforcement is post-run via orchestrator audit. Future hardening (Phase 4+) MAY add `pre-commit` and `pre-push` hooks installed by CogniStore in the managed clone.

#### Scenario: Agent commits despite prompt instruction

- **GIVEN** Phase A completes with one commit on the intake branch
- **WHEN** CogniStore audits post-run
- **THEN** CogniStore surfaces the invariant violation
- **AND** offers `git reset --soft metadata.baseSha` recovery
- **AND** the diff review panel still renders against the original baseSha

### Requirement: Three-action diff review gate

After Phase A completes, CogniStore SHALL render the diff with three mutually exclusive actions: **Reject**, **Refine**, **Approve**.

**Reject** SHALL: discard the intake branch (`git checkout develop && git branch -D <branch>`), move the staging dir to `<auditDir>/rejected-files/`, mark the session `rejected`.

**Refine** SHALL: keep the branch and staging dir intact, re-enable the inbox dropzone, allow the user to drop additional files, and re-run Phase A on top of the existing branch (no `git reset`). Before each Refine iteration, CogniStore SHALL snapshot the working tree state via `git stash create` (which produces a stash commit object without modifying the index). The resulting SHA is recorded as `metadata.refineCheckpoints[N]`. If the iteration's agent invocation exits non-zero or the post-run invariant audit fails, CogniStore SHALL offer a "Roll back to pre-iteration-N state" action that runs `git read-tree --reset -u <checkpointSha>` to restore the prior good state.

**Approve** SHALL: trigger Phase B PR Cut.

#### Scenario: Reject restores files for inspection

- **WHEN** the user clicks Reject
- **THEN** the intake branch is deleted
- **AND** the staging dir is moved to `<auditDir>/rejected-files/`
- **AND** the user can navigate to the audit dir to inspect what was processed

#### Scenario: Refine accumulates work on the same branch

- **GIVEN** Phase A produced a diff and the user clicked Refine
- **WHEN** the user drops more files and clicks Process Inbox again
- **THEN** Phase A runs against the **existing** branch (no reset)
- **AND** the new diff includes both the prior changes and the new ones

#### Scenario: Approve triggers Phase B

- **WHEN** the user clicks Approve
- **THEN** Phase B PR Cut runs and opens a draft PR
- **AND** the UI surfaces the PR URL on success

### Requirement: Phase B — PR Cut agent invocation

On Approve, CogniStore SHALL spawn a second `copilot` invocation using the configured `intakePipeline.prCutModel` (default `gpt-5.4-mini`), `intakePipeline.prCutTimeoutSeconds` (default 120), and a hardcoded prompt template at `cognistore/templates/intake-pr-cut-prompt.md`.

The PR-cut prompt SHALL instruct the agent to perform ONLY: `git add -A`, `git commit -m "<templated message>"`, `git push -u origin <branch>`, `gh pr create --draft --base <intakePipeline.prCutBaseBranch> --title "<templated>" --body "<templated>"`. The prompt SHALL explicitly forbid any analysis work, any push to `<prCutBaseBranch>` directly, and any modification of files.

After Phase B's subprocess exits, CogniStore SHALL run a Phase B post-run invariant audit:

1. The diff between the local intake branch and `origin/<branch>` SHALL be empty (verifies the push happened).
2. `git diff metadata.baseSha..HEAD --name-only` SHALL be **identical** to the file set the user approved at the diff-review gate. If the agent introduced any additional file changes during Phase B, CogniStore SHALL surface "Phase B introduced unapproved changes" and link the user to the pre-approve diff vs the post-Phase-B diff.

#### Scenario: Phase B touches unapproved files

CogniStore SHALL parse the agent's final output for the PR URL pattern (`https://github.com/.+/pull/\d+`) and persist it to the audit log.

#### Scenario: PR Cut opens draft PR

- **WHEN** Phase B runs successfully
- **THEN** the agent opens a draft PR via `gh pr create --draft --base develop`
- **AND** the PR URL is captured and shown in a success card

#### Scenario: PR Cut model failure surfaces error

- **WHEN** Phase B exits non-zero
- **THEN** the UI shows the error and the agent's last output
- **AND** the intake branch remains intact for retry or Reject

### Requirement: Hard guardrail — no editor surface over analysis

CogniStore's UI SHALL NOT expose any text-editor or in-place edit affordance over files matching:

- `01-Projects/<any>/02-analysis/<any>`
- `01-Projects/<any>/03-decisions/<any>`
- `01-Projects/<any>/04-specs/<any>`
- `_graph.json` (any path)
- `Current State Overview.md` (any path)

The only mutation paths to these files SHALL be: (a) drop files into inbox + run intake agent, (b) approve diff to open PR. This guardrail SHALL be enforced as **defense in depth at three layers**:

1. **UI layer** — no editor component is mounted over protected paths. Any file-tree node matching a protected path is rendered as read-only with no double-click-to-edit affordance.
2. **Tauri IPC layer** — the Rust backend exposes a `write_file` IPC command that rejects (with a logged error and a panic in debug builds) any path matching the protected glob set. All non-agent file writes from the frontend MUST go through this IPC.
3. **CI layer** — `scripts/check-no-direct-analysis-writes.sh` grep over CogniStore's source for `writeFile`, `fs.write*`, `std::fs::write`, `tokio::fs::write` against literal-string paths matching the protected globs. This catches direct writes that would bypass the IPC layer.

This guardrail does NOT constrain what the spawned `mojito:second-brain` agent may do inside the managed clone — that is the agent's contract to honor. CogniStore enforces the constraint on its own code paths only.

#### Scenario: Direct write attempt panics

- **GIVEN** a developer adds a code path that calls `std::fs::write` against a path under `01-Projects/.../02-analysis/`
- **WHEN** that code path executes
- **THEN** the Tauri backend SHALL panic with "Direct analysis write blocked by guardrail"

#### Scenario: CI check blocks PR

- **GIVEN** a PR adds JavaScript code that calls `writeFile` against `_graph.json`
- **WHEN** CI runs `scripts/check-no-direct-analysis-writes.sh`
- **THEN** the check SHALL fail with a descriptive error

### Requirement: Audit trail

CogniStore SHALL persist per-session audit artifacts at `${appDataDir}/intake-sessions/<sessionId>/`:

- `original-inbox/` (copy of files as they were when intake started)
- `copilot-session.md` (the `--share` output from Phase A)
- `copilot-session-pr-cut.md` (the `--share` output from Phase B if approved)
- `diff.patch` (the final git diff)
- `metadata.json` (project, branch, models used, status, PR URL, timestamps)

CogniStore SHALL also record session metadata in a SQLite table `intake_sessions` for queryable history.

#### Scenario: Session history is browsable

- **WHEN** the user opens the Session History panel
- **THEN** they see a list of past sessions with project, status (rejected / refined / approved), PR URL (if any), timestamps
- **AND** clicking a session opens the audit dir in the OS file manager

### Requirement: First-run setup gate

CogniStore SHALL probe for `copilot --version`, `gh --version`, `gh auth status`, `git --version`, and `mojito:second-brain` agent availability on app launch and on Project Workspace view open.

If any check fails, CogniStore SHALL:

- Disable the **Process Inbox** button with a tooltip explaining the missing prerequisite.
- Surface a non-blocking banner offering "Open Setup Diagnostics."
- The Diagnostics modal SHALL show live results, OS-specific install snippets (macOS / Windows / Linux), and a Re-check button.

Other CogniStore features (knowledge query, plans, base dashboard) SHALL remain functional even when intake prerequisites are missing.

#### Scenario: Missing copilot CLI gates intake but not the rest

- **GIVEN** `copilot` is not installed
- **WHEN** the user opens CogniStore
- **THEN** the Process Inbox button is disabled
- **AND** the rest of the app (knowledge query, plans, base dashboard) works normally
- **AND** a banner offers Open Setup Diagnostics

#### Scenario: Re-check unlocks intake

- **GIVEN** the user installed `copilot` CLI from the Diagnostics guide
- **WHEN** they click Re-check
- **THEN** the diagnostics refresh
- **AND** the Process Inbox button becomes enabled
