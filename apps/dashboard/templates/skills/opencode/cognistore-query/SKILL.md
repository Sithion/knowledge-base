---
description: "Query CogniStore knowledge base before any task"
---

# cognistore-query

Your FIRST action on every task: search the knowledge base for existing insights.

```
mcp__cognistore__getKnowledge(query: "<describe the task>")
```

Save returned entry IDs for createPlan's relatedKnowledgeIds.

---

## AI Stack POC — Layer precedence (when enabled)

When `cognistore.config.aiStack.enableSbOrchestration` is `true`, treat these three layers as a soft hierarchy and query them in this order before doing analysis:

1. **Second Brain (canonical)** — Decision Records, specs, and 6-phase pipeline outputs at `secondBrainPath` (default: `~/AcuityTech/Second Brain`). Source of truth for cross-project decisions and architecture. *Wave 3 will expose this via `mcp__sb_orchestration__*` tools; until then, read filesystem directly when relevant.*
2. **CogniStore (runtime mirror)** — `mcp__cognistore__getKnowledge` results. Operational notes, patterns, and per-session captures.
3. **Context Engine (per-repo)** — when `.ai/mcp/server.py` (or equivalent) exists in the current working directory, also call `context_retrieve` for repository-specific architecture, decision logs, and dependency hints.

**Conflict resolution:** prefer Second Brain DR/spec content over CogniStore entries when they disagree. This is a *convention*, not a hard rule — exercise judgment when staleness or scope mismatch is obvious. Mention which layer you trusted in your response when it materially affected the answer.

When the flag is off (default), only Layer 2 is in scope and this section can be ignored.

---

## Context Engine deployment (POC)

CogniStore exposes three MCP tools that bootstrap and maintain Context Engine on a target repo:

- `mcp__cognistore__stackInit({ repoPath, sbProject? })` — copies the vendored `.ai/` scaffold and `scripts/` into the repo, runs `setup_context_engine.sh`, optionally pulls Second Brain–derived context. Idempotent on already-initialized repos.
- `mcp__cognistore__stackUpgrade({ repoPath })` — refreshes vendored-owned files; preserves `decisions.log`, `.last-build`, and `.ai/context/sb-derived/`.
- `mcp__cognistore__stackStatus({ repoPath })` — reports `installed`, `version`, `vendoredVersion`, `drift`, `lastBuild`, `sbDerivedPresent`.

The `cognistore-query` skill ships a `context-engine-detect.sh` user-prompt hook that fires once per session at start. If CWD is a git repo with no `.ai/index/`, no `.ai/.no-context-engine` opt-out marker, no `CI` env var, and `cognistore.config.contextEnginePromptDisabled !== true`, it injects a system message asking you to prompt the user: "Initialize Context Engine here? [Y/n/never]". On `never`, write `.ai/.no-context-engine` so the prompt never fires again.

See `docs/context-engine.md` for the full deployment guide and the re-vendoring workflow (`pnpm vendor:context-engine`).
