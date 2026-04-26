---
name: cognistore-query
description: >
  MANDATORY — automatically triggered before ANY task. Query the CogniStore
  semantic database before analysis, implementation, or decision-making.
  This skill MUST run as your FIRST action in every session, every task.
  Do NOT skip. Do NOT defer. Query first, then work.
---

# CogniStore Query

**BLOCKING REQUIREMENT**: Before starting ANY task — analysis, implementation, planning, or decision-making — you MUST query the knowledge base first. This is NOT optional.

## When to Query

- **Start of any task** — ALWAYS, no exceptions
- **Before architectural decisions** — avoid re-deciding what was already decided
- **Encountering unfamiliar code** — load context before reading files
- **Hitting an error or bug** — check if it was seen and fixed before
- **Before writing new code** — reuse existing patterns and conventions

## How to Call

```
mcp__cognistore__getKnowledge(query: "<describe the task or problem>")
```

### Examples

```
mcp__cognistore__getKnowledge(query: "authentication middleware patterns")
mcp__cognistore__getKnowledge(query: "database migration approach")
mcp__cognistore__getKnowledge(query: "React form validation approach")
```

## Evaluate Results

| Similarity Score | Action |
|-----------------|--------|
| > 0.50 | **Use directly** — skip redundant analysis |
| 0.30–0.50 | **Evaluate** — combine with targeted fresh analysis |
| < 0.30 or empty | **Proceed** with full analysis, then capture findings |

## Rules

- **FIRST action of every task** — before reading files, before writing code, before making decisions
- **No exceptions** — no task is "too simple" or "too obvious" to query first
- **A single query costs ~30 tokens** — a missed cache hit wastes 2,000–8,000 tokens on redundant work
- **After completing work** — store new findings using `mcp__cognistore__addKnowledge`

## Knowledge Management: Update, Don't Duplicate

When a query returns an existing entry and your work produces updated information:

- **UPDATE the existing entry** using `mcp__cognistore__updateKnowledge(id, ...)` — do NOT create a new one
- **DELETE obsolete entries** using `mcp__cognistore__deleteKnowledge(id)` if the knowledge is no longer valid
- **Only ADD new entries** when the knowledge is genuinely new (no existing entry covers the topic)

## What's Worth Storing

Only capture knowledge that **saves future sessions significant time**:
- Hard-won root causes, non-obvious gotchas, project-specific decisions, architectural constraints
- NOT: standard docs, trivial fixes, temporary state, obvious patterns
- **Rule of thumb**: web search answers it in 30s → don't store. Took 5+ min to figure out → store it.

## Available Tools

| Tool | Purpose |
|------|---------|
| `mcp__cognistore__getKnowledge` | Query knowledge (this skill) |
| `mcp__cognistore__addKnowledge` | Store new knowledge |
| `mcp__cognistore__updateKnowledge` | Update existing entry |
| `mcp__cognistore__deleteKnowledge` | Remove outdated entry |
| `mcp__cognistore__listTags` | Browse all tags |
| `mcp__cognistore__healthCheck` | Verify system status |

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
