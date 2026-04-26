## Why

The base `ai-stack-poc-cognistore` change ends Phase 2 with two read-mostly dashboard panels (Second Brain browser + Context Engine browser). That gives **developers** a unified front door but leaves the **PM/product persona** still in the same place they are today: opening Second Brain in a Markdown editor, dropping files into `00-Inbox/`, and remembering to invoke the right skills/agents from a terminal they may not own.

This change extends Phase 2 into a **Phase 3 — Intake Pipeline**. Instead of "browse Second Brain content," CogniStore becomes the **front door for inbox-to-PR**:

1. PM picks a Second Brain project from a dropdown sourced from `01-Projects/<slug>/`.
2. PM drops files (transcripts, .docx, screenshots, .eml, .pdf) into the project's inbox via the UI.
3. PM clicks **Process Inbox**. CogniStore spawns the existing `mojito:second-brain` Copilot CLI agent against a **CogniStore-managed Second Brain clone**, streaming the agent's tool calls into the UI as a live transcript.
4. When the agent finishes, the UI renders the resulting `git diff` (analysis updates, gap/question tracker changes, draft DRs). PM can **Reject** (delete branch), **Refine** (drop more files and re-run), or **Approve**.
5. On Approve, CogniStore spawns a second Copilot CLI invocation — using a **cheaper model** by configuration — that does only the mechanical work of committing, pushing the branch, and opening a draft PR via `gh pr create`.

Result: PMs get a desktop UI that produces canonical Second Brain PRs without ever touching a terminal. Developers continue to use Copilot CLI directly. Both personas write to the same `mojito:second-brain` agent and produce identical artifacts. **One pipeline, two front doors.**

## Dependencies

This change is **additive on top of `ai-stack-poc-cognistore` Phase 2**. It does not replace the existing `dashboard-panels` capability — it extends it. The Second Brain panel from Phase 2 becomes a sibling of the new "Project Workspace" view, not a replacement for it.

It also depends on Second Brain exposing a stable **headless agent contract** (new spec in `ai-stack-poc-second-brain/specs/headless-agent-contract/`) so CogniStore's automated invocations have a documented input/output shape to rely on.

## What Changes

### NEW capability `intake-pipeline`

End-to-end inbox-to-PR flow for a single project:

- **Managed Second Brain clone**: CogniStore maintains its own working copy at `${appDataDir}/second-brain-workspace/` (separate from the user's personal `~/AcuityTech/Second Brain/`). Cloned on first use via `gh repo clone`. Before every intake run: `git fetch && git reset --hard origin/develop`. All agent work happens on a fresh `sb-intake/<project>/<timestamp>` branch.
- **Project picker**: enumerates `01-Projects/<slug>/` directories from the managed clone. "+ New Project" affordance scaffolds a new project by invoking `mojito:second-brain --agent-mode scaffold-project` with a small form (name, description) and opens a draft PR via the cheap-model PR-cut step (same as below).
- **Inbox dropzone**: drag-and-drop files into a per-project staging directory (`${managedClone}/00-Inbox/<project>/<intake-session-id>/`). Files are copied (not moved) from source. Validates supported formats (.docx, .xlsx, .pptx, .pdf, .png, .jpg, .eml, .msg, .html, .md, .txt) per the existing Second Brain `document-ingester` skill.
- **Two-phase agent flow**:
  - **Phase A — Intake & Analysis**: `copilot -p "<intake-prompt>" --agent mojito:second-brain --add-dir "${managedClone}" --add-dir "${stagingDir}" --output-format json --allow-all-tools --no-ask-user --model "${userSelectedModel}" --share "${sessionLogPath}"`. The intake prompt (templated, includes project slug + staging dir path) instructs the agent to follow its standard intake → classify → extract requirements → update analysis flow.
  - **Phase B — PR Cut** (only on Approve): a second `copilot -p` invocation using the configured `prCutModel` (default `gpt-5.4-mini`) with a heavily-templated prompt that does only `git add`, `git commit`, `git push`, `gh pr create --draft --base develop --title "..." --body "..."`. No analysis work in this phase.
- **Diff review states**: after Phase A completes, UI shows a three-action panel (Reject / Refine / Approve) with a syntax-highlighted diff of all changes on the intake branch versus `origin/develop`. **Reject** runs `git checkout develop && git branch -D sb-intake/...`, restores inbox files to a "rejected" subfolder for inspection, deletes the staging dir. **Refine** keeps the branch and lets the user drop more files, then re-runs Phase A on top of the existing branch. **Approve** triggers Phase B.
- **Hard guardrail (no editor surface over analysis)**: CogniStore's UI **MUST NOT** expose any editor over `01-Projects/<project>/02-analysis/`, `03-decisions/`, `04-specs/`, `_graph.json`, or `Current State Overview.md`. The only mutation paths are (a) drop files in inbox + run intake agent, (b) approve diff to open PR. This is enforced in code, not just by convention.

### NEW capability `copilot-cli-bridge`

Sidecar contract for spawning `copilot` CLI from CogniStore's Tauri backend:

- **Spawn shape**: subprocess via Rust `std::process::Command` (or `tokio::process::Command` for async). Always with `--output-format json`, `--allow-all-tools`, `--no-ask-user`, `--add-dir` scoped to the managed clone + staging dir. Never `--allow-all-paths` or `--yolo`. Streams stdout line-by-line as JSONL.
- **JSONL event parser**: Tauri backend parses each line into a typed event (`tool_call`, `tool_result`, `text_delta`, `final_message`, `error`) and emits Tauri events to the UI for live transcript rendering.
- **Model catalog**: ships with curated JSON catalog `cognistore/templates/copilot-models.json` listing known model IDs (`auto`, `gpt-5.4`, `gpt-5.4-mini`, `claude-sonnet-4.6`, `claude-haiku-4.5`, `gpt-4.1`) with cost-tier labels (premium/standard/fast). UI dropdown for both the **intake model** and **PR-cut model** populates from this catalog plus an "Other (specify)…" free-text option. No live model list available — Copilot CLI does not expose `--list-models`. Catalog can be refreshed via app updates.
- **BYOK note**: documented support for `COPILOT_PROVIDER_BASE_URL` etc. for users wanting Ollama/Azure/OpenAI BYOK; out-of-scope for the POC default UX but not blocked by it.
- **Error handling**: timeouts (configurable, default 10 minutes for intake, 2 minutes for PR-cut), non-zero exit codes surfaced as UI banners with the agent's last text output, ability to abort an in-flight run (`SIGTERM` to the child process group).
- **Audit trail**: every invocation also passes `--share <intake-session-log-path>` so a markdown record of the full session is preserved under `${appDataDir}/intake-sessions/<id>/copilot-session.md` and surfaced in a "Session History" panel.

### NEW capability `first-run-setup`

Detect-and-fix flow for `copilot` CLI prerequisites:

- On app launch, CogniStore probes for `copilot --version`, `gh --version`, `gh auth status`, `git --version`, and the `mojito:second-brain` agent availability (`copilot --agent mojito:second-brain --help`).
- If anything is missing, a "Setup Required" banner blocks the **Process Inbox** affordance (other CogniStore features remain functional). Banner expands into a per-OS install guide:
  - **macOS**: `brew install gh` + npm install for Copilot CLI + `gh auth login` + `copilot login`.
  - **Windows**: `winget install GitHub.cli` + Node install instructions + `gh auth login` + `copilot login`.
  - **Linux**: best-effort guidance, not gated for the POC.
- A diagnostics modal shows live results of all prereq checks plus a "Re-check" button.
- Once prereqs pass, the banner clears and intake is unlocked.

### NEW capability `intake-testing-plan`

Documented, executable test plan that the agent (or Aaron) follows after specs land. Lives in this proposal so it is treated as part of the deliverable, not a side note. Covers:

- **Stop production CogniStore first** (Aaron is currently running it; local dev build will conflict on the SQLite DB lock).
- Build CogniStore from `feature/ai-stack-poc` locally.
- Bootstrap managed clone, run a synthetic inbox file (small `.txt` + `.md`) through Phase A against a sandbox Second Brain project (`sample-bot` exists in the repo and is non-critical).
- Verify diff renders, Reject path works, Refine path works.
- Run Approve path against a throwaway feature branch in Second Brain (NOT `develop`); verify draft PR opens.
- Fall-back: if local build is blocked (Tauri toolchain, dependency issues), agent guides Aaron through manual end-to-end steps from the terminal that simulate the same flow.

### MODIFIED capability `dashboard-panels` (from base change)

The Second Brain panel from base `ai-stack-poc-cognistore` Phase 2 gains a sibling "Project Workspace" view containing the intake pipeline. The browse-only panel is preserved for read-only viewing of finalized content (DRs, specs, Current State Overview); the Workspace view is for in-flight intake. Cross-link buttons between the two.

## Capabilities

### New Capabilities

- `intake-pipeline` — managed clone, project picker, inbox staging, two-phase agent flow, diff review, hard guardrail.
- `copilot-cli-bridge` — sidecar spawn contract, JSONL streaming parse, curated model catalog, error handling, audit trail.
- `first-run-setup` — OS-aware prereq detect/install/login flow + diagnostics modal.
- `intake-testing-plan` — local end-to-end test plan with guided-manual fallback.

### Modified Capabilities

- `dashboard-panels` (from `ai-stack-poc-cognistore`) — Second Brain panel gains "Project Workspace" sibling view.

## Impact

- **POC convention, not enforced architecture**. Like the base change, this is local-only and treated as a soft norm. Production hardening (concurrency, multi-PM coordination, conflict resolution) is explicitly out of scope.
- **Effort**: rough estimate 8–12 weeks of focused work for full delivery (vs. base Phase 2's 4–6 weeks). The diff review UI + JSONL streaming parser + managed clone lifecycle are the schedule risks.
- **Production CogniStore caveat**: Aaron currently has the published CogniStore app running. The local dev build holds the same SQLite DB lock and will fail to start until production is closed. `intake-testing-plan` calls this out as the first manual step.
- **Single source of skills**: the agent invoked is the same `mojito:second-brain` Copilot CLI agent developers use directly. No fork, no second runtime. This was Aaron's load-bearing decision (#3): "Let's go b so we can directly reuse those existing agents and skills."
- **Hard guardrail is enforced in code**, not policy. The UI must not ship a text-editor surface over analysis files. PM-driven changes flow through the agent or do not happen.
- **No live model list available**: Copilot CLI does not expose `--list-models`. The model dropdown ships with a curated catalog plus a free-text fallback. Catalog updates require an app release. Acceptable for POC.
- **Coordinated changes**:
  - Pairs with `ai-stack-poc-second-brain` — adds `headless-agent-contract` spec (formalizes the intake-prompt input shape and the expected branch/PR output shape so CogniStore can rely on it).
  - Pairs with the base `ai-stack-poc-cognistore` change — modifies `dashboard-panels`, depends on `protocol-hierarchy`, `sb-orchestration-mcp`, and `context-engine-bundle` being present.
  - See `KICKOFF.md` Phase 3 section for the cross-repo gate.
- **Out of scope for this change**:
  - Multi-PM concurrency (per-project lock, conflict resolution between two simultaneous intake sessions). Aaron explicitly deferred (#3): "no worries about concurrency yet — that can be solved later."
  - Auto-merging PRs. PRs always open as **draft**, human reviews + merges via GitHub.
  - Editing the Second Brain agent's behavior. CogniStore is a thin orchestrator — agent quality is a Second Brain concern.
  - Production-grade error recovery. POC failure modes are "show error, ask user to retry."
