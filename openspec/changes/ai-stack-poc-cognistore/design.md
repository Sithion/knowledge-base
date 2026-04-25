# Design — CogniStore: Stack Orchestration + Unified Dashboard

## Context

CogniStore is positioned in the middle of a three-layer AI knowledge stack. Upstream is Second Brain (canonical, git-backed, human-authored). Downstream is Context Engine (per-repo, code-aware retrieval). CogniStore's role:

- **For agents**: a runtime memory mirror with typed/scoped entries, plans, hooks. Must defer to Second Brain when truth conflicts.
- **For humans**: a single front door. Three tools today, one app tomorrow (read-mostly views into the other two).

This design covers both phases in one change to keep the architectural narrative coherent.

## Architecture

```
┌────────────────────────────── CogniStore (this repo) ────────────────────────────┐
│                                                                                    │
│   Phase 1: Orchestration                          Phase 2: Dashboard               │
│   ┌──────────────────────────┐                    ┌──────────────────────────┐    │
│   │ MCP Tools                │                    │ Tauri Renderer           │    │
│   │  secondBrain.runPipeline │                    │  /knowledge   (existing) │    │
│   │  secondBrain.promote...  │                    │  /plans       (existing) │    │
│   │  secondBrain.listProj..  │                    │  /second-brain  (new)    │    │
│   │  secondBrain.lookupTrace.│                    │  /context-engine (new)   │    │
│   └────────────┬─────────────┘                    │  /search       (new)     │    │
│                │                                  │  /health       (new)     │    │
│                ▼                                  └─────────────┬────────────┘    │
│   ┌──────────────────────────┐                                  │                 │
│   │ child_process.spawn      │                                  ▼                 │
│   │   node SB/_tools/...     │                ┌──────────────────────────────┐    │
│   └────────────┬─────────────┘                │ Aggregator services          │    │
│                │                              │  - cognistore-search (existing)│  │
│                ▼                              │  - sb-fs-reader      (new)     │  │
│   ┌──────────────────────────┐                │  - ce-mcp-bridge     (new)     │  │
│   │ UserPromptSubmit hook    │                │  - rg-shell-search   (new)     │  │
│   │   + protocol-hierarchy   │                └──────────────┬─────────────────┘  │
│   │   system knowledge entry │                               │                    │
│   └──────────────────────────┘                               ▼                    │
│                                                ┌──────────────────────────────┐   │
│                                                │ Second Brain repo (read-only)│   │
│                                                │ Context Engine repos (per-..) │   │
│                                                └──────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## Key Decisions

### D-01: Shell-out, don't import
**Decision**: All cross-layer calls (CogniStore → Second Brain scripts, CogniStore → Context Engine MCP) use `child_process.spawn` (or equivalent) with stable CLI contracts.
**Rationale**: Keeps each layer free to evolve internals. Second Brain's scripts are Node, Context Engine's are Python — direct imports would couple us to two runtimes inside the Tauri app.
**Trade-off**: Process startup cost (~50–200ms per call). Acceptable; results cached where reasonable.

### D-02: Dashboard panels render content but never write source-of-truth files
**Decision**: The new Tauri panels never modify Second Brain markdown or Context Engine source files directly. Mutating actions (Promote, Re-index, Initialize) are explicit affordances that **delegate** to the owning system's normal workflow: Promote → opens a draft PR via `secondBrain.promoteDecision`; Re-index → shells out to the repo's existing `build_index.py`; Initialize → invokes `stack.init` which writes to the repo via the vendoring discipline.
**Rationale**: Aaron's mandate: "authoring stays in editor + git." The dashboard provides discovery and orchestration; mutations always travel through the owning system's normal entry points (PRs for SB, build scripts for CE). This avoids the dashboard becoming a third source-of-truth.
**Trade-off**: We can't claim "100% read-only" — the panels DO trigger actions. The honest claim is "render-only for content; mutations delegate via explicit MCP tools and never bypass the owning system's normal review process."

### D-03: Layer-precedence guidance via hook injection (POC = soft norm)
**Decision**: The `UserPromptSubmit` hook injects layer-precedence guidance into agent prompts. There is no runtime arbitration — when an agent asks two layers and gets conflicting answers, the agent (informed by the hook text and the system knowledge entry) decides. This is a **POC convention**, not an enforced invariant.
**Rationale**: Building real arbitration (canonical-content lookup, conflict detection, automatic deferral) would be a separate engineering effort and out of POC scope. Soft guidance covers the common case where agents would otherwise treat layers as equivalent.
**Trade-off**: An off-prompt agent or a non-conforming caller can violate the rule. Acceptable for POC; Phase 3+ may add a real arbitration layer if usage patterns demand it.

### D-04: `enableSbOrchestration` is opt-in
**Decision**: A boolean config flag gates Phase 1 entirely. Existing users see no change unless they flip it.
**Rationale**: Raphael's CogniStore has users who do not have Second Brain checkouts. We must not break them.
**Trade-off**: One more config knob; one-time migration prompt nudges new users to opt in.

### D-05: Dashboard panels lazy-load
**Decision**: The new `/second-brain` and `/context-engine` routes lazy-import their components and aggregator services. The existing app boots with the same time.
**Rationale**: Tauri startup time is already noticeable; loading file-tree libs and dep-graph viz upfront would worsen it.
**Trade-off**: First navigation to a new panel has a small loading delay. Acceptable.

### D-06: Unified search aggregates 3 backends in parallel, returns segmented results
**Decision**: Single search bar fans out to (a) CogniStore semantic search, (b) `rg --json` over Second Brain markdown, (c) `context_retrieve` per configured CE repo. Results render in three labeled sections — not blended into a single ranking.
**Rationale**: Cross-layer ranking is hard (different scoring scales, different relevance semantics). Segmented results let humans visually triage.
**Trade-off**: User must look at three sections instead of one merged list. Worth it given segmentation makes the *source* visible — which is itself information.

### D-07: Health pane is a stack-wide vital sign
**Decision**: Health indicators surface the *worst* of {Ollama, SB sync age, CE index age, hook injection self-test} as a status-bar element on every screen.
**Rationale**: Users need a fast "am I working off stale truth?" signal. Burying this in a single panel means people forget to check.
**Trade-off**: Requires a thin pub-sub for status updates from background checks. Ship as part of this change.

### D-08: CogniStore is the deployment surface for Context Engine; source-of-truth stays in ai-projects
**Decision**: Context Engine templates (the `.ai/` scaffold + bootstrap/setup scripts + `requirements-context.txt`) are vendored into `cognistore/templates/context-engine/` from `~/AcuityTech/ai-projects/` at release time. CogniStore exposes `stack.init` / `stack.upgrade` / `stack.status` MCP tools and a `ContextEngineDetect` hook that auto-prompts users when they're working in a repo without Context Engine. The Python *runtime* (LlamaIndex, ChromaDB, sentence-transformers, embedding model) continues to run per-repo — CogniStore does not host it.
**Rationale**: Aaron (2026-04-23): "bundle the scripts as a template into cognistore — when a user is working with an agent in a repo and cognistore realizes it doesn't have context engine setup yet, it can do so automatically." This gives users a single front door and natural auto-discovery without forcing CogniStore (Tauri/Node/Rust) to host a Python runtime. Vendoring (rather than physical merge or runtime hosting) preserves Context Engine's clean per-repo Python contract while giving CogniStore the deployment UX.
**Trade-off**: We carry a vendored copy that drifts from upstream until re-vendored. Mitigated by: (a) `npm run vendor:context-engine` as the only edit path; (b) CI rejects PRs editing vendored files without a `VERSION` bump; (c) `stack.status` reports drift between the target repo's installed version and the currently-vendored version. Phase 3+ replaces vendoring with a published pypi package.

### D-10: stack.init/upgrade enforce a file-ownership matrix
**Decision**: `context-engine-bundle/spec.md` defines four file categories — vendored-owned, user-owned, mergeable, never-touched — and `stack.init` / `stack.upgrade` honor them strictly. `stack.init` aborts on vendored-owned conflicts unless `--adopt` is passed; `stack.upgrade` always preserves user-owned content.
**Rationale**: Repos in the wild may have hand-installed Context Engine, partial installs, or stale versions. Without an explicit ownership map, "idempotent" / "overwrite" / "preserve" become ambiguous and bug-prone.
**Trade-off**: Operators must learn `--adopt` for the partial-install case. Single discoverable flag with a remediation hint in the conflict error message — acceptable.

### D-11: Python prerequisites are preflight-checked, not assumed
**Decision**: `stack.init` runs preflight checks (python3 ≥ 3.10, disk space, network) BEFORE copying any files. Failure produces a structured `{ initialized: false, reason, remediation }` shape rather than a partial install.
**Rationale**: Context Engine's setup script today does naive `python3 -m venv` + `pip install` and fails opaquely when prerequisites are missing. Hidden behind the dashboard prompt UX (Gate 1.D), opaque failures would damage user trust in the auto-prompt feature.
**Trade-off**: Preflight adds ~1s to init time; some checks (disk space, network) are heuristic and may give false positives. Acceptable — the remediation messages are actionable.
**Decision**: `ContextEngineDetect` does NOT prompt when (a) the env var `CI` is set, (b) the file `.ai/.no-context-engine` exists in the repo, or (c) `cognistore.config.contextEnginePromptDisabled` is true. The hook also de-dupes within a session (one prompt max).
**Rationale**: Without these guardrails, the prompt becomes noise in CI runs, in repos that shouldn't have Context Engine (POC scratch dirs, docs-only repos), and for users who explicitly don't want it.
**Trade-off**: Three independent suppression mechanisms feel redundant but each addresses a different actor: CI runner, repo owner, user. Combining them would break at least one use case.

## System Knowledge Entry — Layer Precedence Rule

Inserted at install when `enableSbOrchestration` is enabled:

```
title: AI Knowledge Stack — Layer precedence (POC convention)
type: system
scope: global
tags: [protocol-hierarchy, system, ai-stack-poc]
content: |
  Three knowledge layers exist in this environment:
    1. Second Brain (~/AcuityTech/Second Brain) — canonical source of truth.
       Markdown + git, human-ratified DRs and specs, frontmatter graph.
    2. CogniStore (this knowledge base) — runtime mirror + ephemeral session memory.
       Read replica of Second Brain content; agents capture tactical decisions here.
    3. Context Engine (per-repo .ai/) — code-aware retrieval for the current repo.
       Indexes source code + dependency graph.

  Precedence rule when conflicts arise:
    Second Brain content wins over CogniStore content of the same id.
    CogniStore plans/tactical decisions are ephemeral; promote strategic ones to
    Second Brain DR drafts via `secondBrain.promoteDecision`.

  Workflow:
    - Always call getKnowledge() first.
    - If `.ai/mcp/server.py` exists in CWD, also call context_retrieve.
    - For tasks scoped to a Second Brain project, consult
      `secondBrain.lookupTraceability(artifactId)` to understand DR/source provenance.
    - When you capture a decision in CogniStore, ask: "is this strategic? promote it
      via `secondBrain.promoteDecision`."
```

## UI Library Choice (Phase 2)

The Tauri app currently uses [whatever Raphael's existing UI stack is — TBD-confirm-on-first-touch]. Options for the new file-tree:

- Reuse the existing component lib if it has a tree.
- If not, introduce a small, dependency-free tree (we own the SB shape; ~150 LoC).

Decision deferred to first PR session against the codebase. Captured here as an acknowledged unknown.

## Open Questions

- **OQ-01**: Where do dashboard panel preferences live? (config file vs DB vs OS keychain). Recommend: same place existing CogniStore prefs live; introduce no new mechanism.
- **OQ-02**: Should `secondBrainPath` accept multiple roots (e.g., for users with multiple Second Brain checkouts on different clients)? POC assumes single root. Future work if requested.
- **OQ-03**: Should the unified search learn-to-rank over time? POC: no, segmented results only. Future telemetry-based ranking is a separate proposal.
- **OQ-04**: How do hook self-tests work without polluting real knowledge entries? POC: write to a dedicated `system:health` scope, GC after 24h.

## Non-Goals

- Becoming a Second Brain editor.
- Becoming a code editor / IDE.
- Replacing the existing CogniStore knowledge model with a Second Brain-shaped one.
- Multi-machine sync of CogniStore state. Each user's CogniStore stays single-machine.
