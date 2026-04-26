# Design — CogniStore Intake Pipeline

## Context

This design extends the base `ai-stack-poc-cognistore` design with the intake-pipeline expansion. Read the base design first (`openspec/changes/ai-stack-poc-cognistore/design.md`) for context on Tauri/MCP/SQLite layout, the protocol-hierarchy hook, and the context-engine-bundle ownership matrix.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  CogniStore Tauri App                                           │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  UI (React)                                             │    │
│  │  ┌──────────────────────────────────────────────────┐   │    │
│  │  │ Project Workspace View                           │   │    │
│  │  │   • Project picker (from 01-Projects/)           │   │    │
│  │  │   • Inbox dropzone                               │   │    │
│  │  │   • Live agent transcript (JSONL stream)         │   │    │
│  │  │   • Diff review (Reject/Refine/Approve)          │   │    │
│  │  └──────────────────────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                          ↕ Tauri events                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Tauri Backend (Rust)                                   │    │
│  │   • Managed clone lifecycle                             │    │
│  │   • Sidecar spawn (copilot CLI)                         │    │
│  │   • JSONL event parse → Tauri events                    │    │
│  │   • git/gh shell-out (PR creation)                      │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                          ↓ subprocess
              ┌──────────────────────────────┐
              │  copilot CLI                 │
              │   --agent mojito:second-brain│
              │   --output-format json       │
              │   --add-dir <managed-clone>  │
              │   --add-dir <staging-dir>    │
              └──────────────────────────────┘
                          ↓ git ops
              ┌──────────────────────────────┐
              │  Managed Second Brain clone  │
              │  ${appDataDir}/              │
              │   second-brain-workspace/    │
              └──────────────────────────────┘
                          ↓ gh pr create (Phase B)
              ┌──────────────────────────────┐
              │  GitHub: draft PR to develop │
              └──────────────────────────────┘
```

## Decisions

### D-01: Managed clone, not user's personal clone

The intake pipeline operates on a CogniStore-owned clone at `${appDataDir}/second-brain-workspace/`, never on the user's `~/AcuityTech/Second Brain/`.

**Reasoning**:
- The hard guardrail ("user can never directly edit analysis") only works if CogniStore controls the working tree. If CogniStore mutates the user's clone, any uncommitted local changes the user has cause merge collisions and ambiguity about whether the diff being reviewed came from the agent or the user.
- A managed clone enforces the "fresh from origin/develop" precondition for every intake run. `git fetch && git reset --hard origin/develop` is safe because there are no local edits to lose.
- Per-app clone is well-precedented (VS Code's `globalStorageUri`, JetBrains' caches). Disk cost (~50–200 MB) is negligible.

**Tradeoff**: developers who want to see the in-flight intake branch in their own clone must `git fetch` after the PR is opened. Acceptable — they review on GitHub or `gh pr checkout`.

### D-02: Two-phase agent flow with separate models

Intake (Phase A) and PR-cut (Phase B) are **two separate `copilot` invocations**, each with its own model.

**Reasoning**:
- Phase A is heavy reasoning (parse arbitrary documents, classify, extract requirements, update analysis). Needs a capable model.
- Phase B is mechanical (git add/commit/push, gh pr create with a templated body). A cheap model handles this in seconds with a heavily-templated prompt.
- Cost difference is ~10× per invocation. Per intake session, this matters.
- Separating them also gives the user a clean "review & approve" gate between the expensive work and the irreversible PR creation.

**Tradeoff**: two subprocess startups instead of one (~80–200ms each). Negligible.

### D-03: Subprocess shell-out, not Copilot SDK

The Tauri backend shells out to `copilot` CLI as a child process. It does not adopt the Copilot SDK directly.

**Reasoning** (carried from cross-language IPC pattern in CogniStore knowledge base):
- Reuses the same agent definitions (`mojito:second-brain`) developers use today. Zero fork.
- Avoids forking the agent runtime: skill files, permission prompts, BYOK config, all behave identically to the dev experience.
- Tauri Rust backend doesn't gain a Node runtime dependency.
- JSONL streaming via `--output-format json` gives us all the structured events the SDK would have provided.

**Tradeoff**: subprocess startup ~80–200ms. Imperceptible for a multi-minute intake session. If we ever need streaming events the CLI doesn't expose, revisit.

### D-04: JSONL event parser owns transcript rendering

The Tauri backend parses each JSONL line into typed events and re-emits them as Tauri events to the React UI. The UI renders an "agent transcript" view that looks similar to a CLI session but with rich formatting.

**Reasoning**: this is the contract that makes the UX feel "live" rather than "spinner until done." Without it, the user has no signal whether the agent is making progress. With it, the UI can show "📄 Reading file X.docx," "🔍 Searching codebase for Y," "✏️ Updating analysis Z" in real time.

**Implementation note**: define the event types as Rust enums so unknown event kinds in future Copilot CLI versions degrade gracefully (rendered as raw JSON in a "debug" mode).

### D-05: Hard guardrail enforced in UI code

There is no React route, no Tauri command, and no MCP tool that mutates files under `01-Projects/<project>/02-analysis/`, `03-decisions/`, `04-specs/`, `_graph.json`, or `Current State Overview.md`. The only mutation path is "spawn copilot CLI which then writes via its agent skills."

**Reasoning**: the user explicitly required this. "The user should NEVER be able to directly modify any of the analysis, it has to go through the second brain process of ingestion in order to change the analysis so it stays guardrailed."

**Implementation note**: a CI check in CogniStore's repo greps the codebase for any direct write operation against the protected paths and fails the build. Even renderers must use read-only file APIs.

### D-06: Curated model catalog, not live list

Ships as JSON in `cognistore/templates/copilot-models.json`. Updated via app releases.

**Reasoning**: Copilot CLI offers no `--list-models` subcommand. Hardcoding the dropdown gives users a known-good list with cost-tier labels. The "Other (specify)…" free-text option preserves the ability to use any model the CLI accepts (including BYOK model IDs).

**Tradeoff**: when GitHub adds a new model, CogniStore needs an app release to surface it in the dropdown. Free-text fallback mitigates this.

### D-07: Project picker source of truth = managed clone filesystem

The dropdown enumerates `${managedClone}/01-Projects/*/`. No project metadata service, no central registry.

**Reasoning**: filesystem is already the source of truth for Second Brain project identity. Adding any other registry creates two-source-of-truth problems. The "+ New Project" affordance just adds a new directory via the agent's normal scaffold flow.

**Edge case**: duplicate or near-duplicate project slugs exist today (`Claims Center` vs `claims-center`, etc.). The picker shows both; resolving these is a Second Brain concern, not a CogniStore concern.

### D-08: First-run setup blocks the intake feature only, not the whole app

If `copilot` CLI is missing or unauthenticated, the Process Inbox button is disabled with an explanatory tooltip and a banner offers the install/login guide. The rest of CogniStore (knowledge query, plans, dashboard) remains usable.

**Reasoning**: existing CogniStore users without intake needs shouldn't be punished by a hard block. Intake is a new capability; gracefully gate just that.

### D-09: Refine path keeps the branch, re-runs intake on top

When the user clicks **Refine**, CogniStore does NOT delete the intake branch or reset it. The user drops additional files into the staging dir, and the next Phase A invocation runs on top of the existing branch.

**Reasoning**: this preserves the agent's accumulated reasoning across iterations. The agent sees both the original analysis updates and the new files, making it easy to extend rather than re-do.

**Tradeoff**: if the agent makes a mistake in iteration 1, iteration 2 inherits it. The Reject button always exists for hard restart. Documented in user-facing UX text.

### D-10: PR-cut prompt is templated, not generated

The Phase B prompt is a hardcoded template stored in `cognistore/templates/intake-pr-cut-prompt.md` with placeholders for project, branch, files-changed summary, and intake session ID. The cheap model fills in the PR title and body via the template.

**Reasoning**: PR creation is mechanical. A template forecloses on agent improvisation in the irreversible step. If the model deviates from the template (e.g., tries to push to `develop` instead of opening a PR), CogniStore catches it because the PR-cut prompt explicitly forbids `git push origin develop` and the agent operates with `--add-dir` scoped only to the managed clone (cannot write elsewhere).

### D-11: Audit trail in `${appDataDir}/intake-sessions/<id>/`

Every intake session creates a directory containing: the original inbox files, the `copilot --share` markdown session log, the final `git diff`, the Phase A and Phase B model choices, the resulting PR URL (if approved).

**Reasoning**: PMs need a way to find "what did I send through last Tuesday?" The Session History panel reads this directory. Also useful for debugging when the agent does something unexpected.

### D-12: Mode enforcement is post-run audit, not prompt trust

The headless-agent-contract specifies `MODE: intake | pr-cut | scaffold-project` directives, but the existing `mojito:second-brain` agent does not yet enforce mode-based tool restrictions. CogniStore therefore enforces mode contracts via **post-run invariant audits** in the orchestrator:

- **Phase A audit**: no commits beyond `baseSha`, no remote refs created, no writes outside `${managedClone}`.
- **Phase B audit**: push completed (local == remote), file set unchanged from approved set (warn on expansion).

**Reasoning**: We cannot rely on prompt instructions alone — the agent may "helpfully" commit. Post-run audit makes violation visible and offers one-click recovery (`git reset --soft baseSha`). Future hardening can install `pre-commit`/`pre-push` hooks in the managed clone to catch violations earlier; deferred for the POC.

### D-13: Single-instance lock, not multi-PM concurrency

The managed clone is guarded by an OS-level `flock`/`LockFileEx` on `.cognistore-intake.lock`. A second CogniStore instance refuses to run intake (other features remain functional).

**Reasoning**: Concurrency is explicitly deferred per Aaron's decision. Without a lock, two instances racing on the same managed clone could destroy each other's branches. The lock is the minimum viable safety net.

### D-14: Base-branch drift handled at Approve, not throughout

`origin/develop` may advance during a long review. We capture `baseSha` at intake start, refresh `origin/develop` at Approve time, and gate Approve until the user re-acknowledges the (possibly different) diff. No automated rebase.

**Reasoning**: Automated rebase risks silently changing what the user reviewed. Surfacing drift + re-acknowledgment matches the existing PR review mental model PMs already understand.

### D-15: Defense-in-depth guardrail (3 layers)

Hard guardrail against direct analysis edits is enforced at: (1) UI (no editor mounted), (2) Tauri IPC (single `write_file` command rejects protected paths), (3) CI (grep for direct write calls in source). The guardrail only constrains CogniStore's own code — the spawned agent operating inside the managed clone is contractually bound but not technically restricted by this guardrail.

**Reasoning**: Earlier draft only had CI + runtime panic. Adding the IPC layer means even a renegade frontend bundle cannot bypass via direct Tauri commands. UI-layer enforcement keeps the guardrail visible during development.

### D-16: Setup probing splits availability vs smoke

Earlier draft used `copilot --agent mojito:second-brain --help` to probe agent availability; this is brittle (may pass while runtime auth is broken). New design: 4 availability probes (binary versions + `gh auth status`) followed by a single smoke probe (`copilot ... -p "Reply with the exact word OK"`) that exercises the full path: binary, login, agent resolution, JSONL parsing.

**Reasoning**: A smoke probe distinguishes "installed but expired" from "not installed", giving PMs actionable guidance instead of a generic failure.

### D-17: PR-cut base branch is configurable

`intakePipeline.prCutBaseBranch` (default `develop`) controls the `--base` arg of `gh pr create`. This makes end-to-end testing safe (point at `test/intake-pipeline-poc-base`) without forking the prompt template.

**Reasoning**: Testing plan needs to demonstrate Approve without polluting real `develop`. Hardcoding `develop` would force test-only prompt forks.

### D-18: Refine-iteration checkpointing

Each Refine iteration first creates a `git stash create` snapshot SHA recorded in `metadata.refineCheckpoints[N]`. On iteration failure (non-zero exit or invariant violation), CogniStore offers `git read-tree --reset -u <sha>` rollback.

**Reasoning**: Without checkpointing, a partial-failure iteration leaves a mixed tree (some new edits, some old) with no recovery path short of full Reject. Stash-create is non-destructive (no index mutation) and cheap.

### D-19: `git clone` for bootstrap, `gh` only at PR cut

Initial clone uses plain `git clone` (no `gh auth` required). `gh` is only required at Phase B (PR creation).

**Reasoning**: Decouples bootstrap from PR-cut prereqs. PMs whose `gh auth` lapsed can still complete intake/review; only Approve is gated.

### D-20: Managed-clone freshness is a CogniStore-wide concern, not just intake

The managed Second Brain clone (this spec's `${appDataDir}/second-brain-workspace/`) is shared with a freshness service defined in the broader `ai-stack-poc-cognistore/specs/sb-orchestration-mcp` capability. That service auto-fetches + auto-runs the SB→CogniStore sync script on app launch and before any SB-context-using operation, keeping each developer's local CogniStore DB in lockstep with `origin/develop` even when no intake is happening.

**Reasoning**: Without this, a developer using CogniStore to write specs or implement features would query stale SB context whenever a coworker pushed new DRs. The intake pipeline's per-session fetch+reset alone only covers intake invocations; non-intake reads (the `secondBrain.*` MCP tools, `getKnowledge` queries that touch SB-tagged entries, dashboard panel renders) would silently lag.

**Coordination**: Both flows share the `.cognistore-intake.lock`. Intake takes precedence — if held, the freshness service skips (intake's own fetch+reset is equivalent). If the freshness service is mid-sync when intake starts, intake waits on the lock as usual. Single-instance lock plus single in-process freshness mutex prevents redundant fetches.

**Failure mode**: Freshness errors (offline, malformed DR breaks sync) never block CogniStore — the user sees a non-blocking warning banner and gets cached SB content; the next trigger retries.

## Open Questions

- **OQ-1**: Should the `mojito:second-brain` agent definition be vendored into CogniStore as a fallback (in case the user's plugin is missing or out of date), or assumed to be installed by `first-run-setup`? Current spec assumes installed; vendoring adds resilience but creates a fork risk. Defer to first POC demo.
- **OQ-2**: When the user picks **Refine** repeatedly, the staging dir grows. Do we (a) accumulate, (b) require the user to clear, (c) auto-archive previous iteration on each Refine? Current spec says (a) accumulate. May need adjustment after PM testing.
- **OQ-3**: PR-cut model defaults to `gpt-5.4-mini`. If GitHub deprecates or renames it, this becomes a runtime failure. Catalog refresh + free-text fallback covers it but worth a watch-item.
- **OQ-4**: The `mojito:second-brain` agent does not currently parse `MODE:` directives. Until it does, mode enforcement is purely post-run audit (D-12). Should this POC include a small PR to the Mojito agent definitions to make `MODE:` first-class? Defer; post-run audit is sufficient for POC validation.
- **OQ-5**: macOS lacks `prctl(PR_SET_PDEATHSIG)`. Polling supervisor + lockfile-with-PID is the POC fallback. Acceptable risk for single-user dev machines; revisit if we ever ship multi-user.
