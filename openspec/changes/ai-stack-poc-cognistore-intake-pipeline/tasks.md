# Tasks — CogniStore Intake Pipeline

## 1. Managed clone lifecycle

- [ ] 1.1 Add `intakePipeline.workspaceDir` to `cognistore.config` (default `${appDataDir}/second-brain-workspace`) and `intakePipeline.secondBrainRepoUrl` (no default — required to enable intake). Add `intakePipeline.prCutBaseBranch` (default `develop`) for testability.
- [ ] 1.2 Implement Rust helper `ensure_managed_clone(workspaceDir, repoUrl) -> Result<PathBuf>`:
  - If dir does not exist → `git clone <repoUrl> <workspaceDir>` (use `git`, not `gh`, so cloning does not require `gh auth`; `gh` is only needed at PR-cut time)
  - If dir exists but not a git repo → error
  - If dir exists and is git repo → `git fetch origin develop`; warn-if-behind via UI banner
- [ ] 1.3 Implement `prepare_intake_branch(workspaceDir, project) -> Result<{branch, baseSha}>`:
  - `git checkout develop && git reset --hard origin/develop`
  - Capture `git rev-parse origin/develop` as `baseSha`
  - `git checkout -b sb-intake/${project}/${utc-iso-timestamp-no-colons}`
  - Returns `{branch, baseSha}`
- [ ] 1.4 Implement `discard_intake_branch(workspaceDir, branch)`:
  - `git checkout develop && git branch -D <branch>`
- [ ] 1.5 First-run safety: if managed clone has uncommitted changes, refuse all intake actions and surface a "Reset workspace" affordance that does `git stash drop && git reset --hard origin/develop`.
- [ ] 1.6 Implement OS file lock on `${managedClone}/.cognistore-intake.lock` via `fs2` crate (`flock`/`LockFileEx`); acquire before any mutating op, release on process exit (OS reclamation handles crash). If lock not acquirable in 2s, surface "Another CogniStore instance is using the managed clone."
- [ ] 1.7 Implement `check_base_drift(workspaceDir, baseSha) -> Option<DriftInfo>` — fetches `origin/develop` and returns `Some({newSha, commitsAhead})` if `origin/develop` advanced. Called pre-Approve to gate the Approve button.

## 2. Project picker & inbox staging

- [ ] 2.1 Tauri command `list_sb_projects()` reads `${managedClone}/01-Projects/*/` entries that contain `AGENTS.md`. Returns `[{slug, displayName, lastModified}]`.
- [ ] 2.2 React component `ProjectPicker` with searchable dropdown + "+ New Project" affordance.
- [ ] 2.3 Tauri command `start_intake_session(project) -> { sessionId, stagingDir, intakeBranch }`:
  - Calls `prepare_intake_branch`
  - Creates `${managedClone}/00-Inbox/${project}/${sessionId}/`
  - Creates `${appDataDir}/intake-sessions/${sessionId}/` for audit artifacts
- [ ] 2.4 React `InboxDropzone` component accepts drag-and-drop, validates extensions against the allow-list (.docx, .xlsx, .pptx, .pdf, .png, .jpg, .jpeg, .tiff, .eml, .msg, .html, .md, .txt), copies to staging via `copy_to_staging` Tauri command.
- [ ] 2.5 "+ New Project" flow: small form (slug validated against `^[a-z0-9-]+$`, display name, one-line description), spawns intake agent with a `scaffold-project` prompt template, runs Phase B (PR cut) on success.

## 3. Copilot CLI bridge

- [x] 3.1 Add `intakePipeline.intakeModel` (default `gpt-5.4` or `auto`), `intakePipeline.prCutModel` (default `gpt-5.4-mini`), `intakePipeline.intakeTimeoutSeconds` (default 600), `intakePipeline.prCutTimeoutSeconds` (default 120).
- [x] 3.2 Ship `cognistore/templates/copilot-models.json` with curated model list (premium / standard / fast tiers).
- [x] 3.3 Implement Rust `spawn_copilot(args: CopilotArgs) -> Result<ChildHandle>` using `tokio::process::Command`. Reads stdout line-by-line, parses each line as JSON, emits typed Tauri events (`agent-transcript-event` with payload `{sessionId, eventType, data}`). Captures stderr to `${appDataDir}/intake-sessions/${sessionId}/copilot-session-${phase}.stderr.log`; pattern-matches stderr for `401 Unauthorized`, `ENOTFOUND`, `model.+not.+found`, `agent.+not.+found` and emits `Error` events.
- [x] 3.4 Define event types as Rust enum: `ToolCall { tool, args }`, `ToolResult { tool, ok, summary }`, `TextDelta { content }`, `FinalMessage { content }`, `Error { message }`, `Unknown { raw }`.
- [x] 3.5 Implement cross-platform process group lifecycle:
  - **macOS/Linux**: `Command::pre_exec` calls `setsid()`; abort uses `killpg(-pid, SIGTERM)` then `SIGKILL` after 5s. Linux additionally sets `prctl(PR_SET_PDEATHSIG, SIGKILL)` so child dies if parent crashes.
  - **Windows**: spawn with `CREATE_NEW_PROCESS_GROUP`; assign child to a Job Object via `AssignProcessToJobObject`; abort calls `TerminateJobObject`.
- [x] 3.6 Always pass `--share ${appDataDir}/intake-sessions/${sessionId}/copilot-session-${phase}.md` for audit.
- [x] 3.7 Always pass `--add-dir ${managedClone} --add-dir ${stagingDir}`. Never `--allow-all-paths` or `--yolo`.

## 4. Phase A — Intake & Analysis invocation

- [ ] 4.1 Ship `cognistore/templates/intake-prompt.md` with placeholders for `{{project}}`, `{{stagingDir}}`, `{{intakeSessionId}}`, `{{managedClone}}`. **First line is `MODE: intake`** per headless-agent-contract. Prompt instructs the agent to follow standard `mojito:second-brain` intake flow on staged files, classify, extract requirements, update analysis, draft DRs, but **do not commit and do not push**.
- [ ] 4.2 Tauri command `run_intake_phase_a(sessionId)` renders the prompt, spawns `copilot` with intake model + intake timeout, streams events, awaits exit.
- [ ] 4.3 On exit, run **post-run invariant audit** (`audit_phase_a(sessionId, baseSha)`):
  - `git rev-list ${baseSha}..HEAD` MUST be empty (no commits)
  - `git ls-remote origin ${branch}` MUST be empty (no remote ref)
  - All file changes MUST be inside `${managedClone}`
  - On violation: surface a banner with one-click `git reset --soft ${baseSha}` recovery
- [ ] 4.4 Compute `git diff ${baseSha}..HEAD` in managed clone; persist to `${appDataDir}/intake-sessions/${sessionId}/diff.patch`.
- [ ] 4.5 For Refine iterations: snapshot working tree via `git stash create` before each iteration; record SHA in `metadata.refineCheckpoints[N]` for rollback.
- [ ] 4.6 Emit Tauri event `intake-phase-a-complete` with payload `{sessionId, exitCode, diffPath, diffStat, invariantViolations}`.

## 5. Diff review & three-action gate

- [ ] 5.1 React `DiffReviewPanel` reads `diff.patch` and renders with syntax highlighting (use existing CogniStore markdown rendering as a base).
- [ ] 5.2 Pre-Approve drift check: call `check_base_drift`; if `develop` advanced, refresh diff against new `origin/develop`, surface "develop advanced by N commits" banner, gate Approve until user clicks "I've reviewed the refreshed diff."
- [ ] 5.3 Three actions:
  - **Reject** → call `reject_intake_session(sessionId)`: `discard_intake_branch`, move staging dir to `${appDataDir}/intake-sessions/${sessionId}/rejected-files/`, mark session `rejected` in audit log.
  - **Refine** → re-enable inbox dropzone, allow user to add files, re-run Phase A on top of existing branch (do NOT reset). On post-run invariant violation OR non-zero exit during Refine, offer "Roll back to pre-iteration-N state" via `git read-tree --reset -u <checkpointSha>`.
  - **Approve** → call `run_intake_phase_b(sessionId)`.
- [ ] 5.4 Show transcript history (collapsible) above the diff so the user has context on the agent's reasoning when reviewing.

## 6. Phase B — PR Cut invocation

- [ ] 6.1 Ship `cognistore/templates/intake-pr-cut-prompt.md` with placeholders for `{{project}}`, `{{branch}}`, `{{filesChangedSummary}}`, `{{intakeSessionId}}`, `{{prCutBaseBranch}}`. **First line is `MODE: pr-cut`** per headless-agent-contract. Prompt instructs the cheap model to: stage all changes on the branch, commit with a templated message, push the branch, open a draft PR via `gh pr create --draft --base {{prCutBaseBranch}}`. Forbids any analysis work.
- [ ] 6.2 Tauri command `run_intake_phase_b(sessionId)` spawns `copilot` with PR-cut model + PR-cut timeout.
- [ ] 6.3 Post-run invariant audit `audit_phase_b(sessionId)`:
  - `git diff ${branch} origin/${branch} --name-only` MUST be empty (push happened)
  - The file set in `git diff ${baseSha}..HEAD --name-only` MUST equal the approved file set (warn if expanded; flag in audit log)
- [ ] 6.4 Parse final agent output for the PR URL (`gh pr create` writes it to stdout); persist to audit log.
- [ ] 6.5 Emit Tauri event `intake-phase-b-complete` with payload `{sessionId, prUrl, invariantViolations}`.
- [ ] 6.6 UI shows a success card with the PR URL + "Open in GitHub" button + "Start another intake session" affordance.

## 7. First-run setup

- [ ] 7.1 Tauri command `check_intake_prereqs() -> PrereqReport` runs availability probes (`copilot --version`, `gh --version`, `gh auth status`, `git --version`) in parallel, then if all pass runs the **smoke probe**: `copilot --no-ask-user --allow-all-tools --output-format json --add-dir <tmp> --agent mojito:second-brain -p "Reply with the exact word OK and nothing else."` against a temp scratch dir. PASS iff exit 0 + final assistant message contains `OK` within 30s.
- [ ] 7.2 React `SetupRequiredBanner` renders when any check fails; gates the Process Inbox button.
- [ ] 7.3 React `DiagnosticsModal` shows live results (separating availability vs smoke), Re-check button, OS-specific install snippets (per OS detected via Tauri `os` plugin). Smoke probe failure surfaces specific guidance ("Copilot is installed but login is expired. Run `copilot login` and re-check.").
- [ ] 7.4 Document install snippets for macOS/Windows/Linux in `cognistore/templates/intake-setup-guide.md` (rendered into the modal).
- [ ] 7.5 Provide a "Test intake against sample-bot project" button that runs a no-op intake (drops a `.txt` "hello world" file, runs Phase A only, shows the diff, requires user to Reject) — validates the entire pipeline before real use.

## 8. Hard guardrail enforcement (defense in depth)

- [ ] 8.1 **CI layer**: `scripts/check-no-direct-analysis-writes.sh` greps for `writeFile`, `fs.write*`, `std::fs::write`, `tokio::fs::write` against patterns matching `01-Projects/*/02-analysis/`, `03-decisions/`, `04-specs/`, `_graph.json`, `Current State Overview.md`. Any match fails the build.
- [ ] 8.2 **Tauri IPC layer**: All file writes from frontend route through a single `write_file(path, content)` IPC command that rejects (debug: panic; release: error + log) any path matching the protected glob set.
- [ ] 8.3 **UI layer**: File-tree component renders protected paths as read-only with no edit-on-double-click affordance. Add a Storybook test that confirms protected nodes never mount an editor.
- [ ] 8.4 Document the three-layer guardrail in `CONTRIBUTING.md`: "PRs that add direct analysis writes will be rejected by CI. Only the spawned `mojito:second-brain` agent (running inside the managed clone) may mutate analysis files."

## 9. Audit trail

- [ ] 9.1 Define `IntakeSession` SQLite table: `id, project, branch, status, intakeModel, prCutModel, prUrl, createdAt, completedAt`.
- [ ] 9.2 Tauri commands `list_intake_sessions(filter?)` and `get_intake_session(id)`.
- [ ] 9.3 React `SessionHistoryPanel` shows recent sessions with status badges, links to the audit dir.

## 10. Cross-references and KICKOFF integration

- [ ] 10.1 Update existing `ai-stack-poc-cognistore` proposal Phase 2 section to reference this change as the concrete UX expansion.
- [ ] 10.2 Update `ai-projects/ai-tooling/KICKOFF.md` with Phase 3 section + revised gates.
- [ ] 10.3 Add Second Brain `headless-agent-contract` spec link from this proposal's Dependencies section.

## 11. Testing — see `specs/intake-testing-plan/spec.md`

- [ ] 11.1 Pre-flight: stop production CogniStore (Aaron's running instance).
- [ ] 11.2 Build CogniStore from `feature/ai-stack-poc` locally.
- [ ] 11.3 Run the test plan against `sample-bot` project end-to-end.
- [ ] 11.4 Document any deviations / surprises in a session note.
- [ ] 11.5 Fall-back: if local build is blocked, agent guides Aaron through manual end-to-end steps from a terminal that simulate the same flow.
