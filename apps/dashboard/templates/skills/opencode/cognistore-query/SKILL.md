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
