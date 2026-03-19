---
name: ai-knowledge-capture
description: >
  Store discoveries, decisions, fixes, and patterns in the AI Knowledge
  semantic database. MANDATORY: Every agent must capture knowledge after
  completing work — fixes, decisions, patterns, constraints, and gotchas.
---

# AI Knowledge Capture

**MANDATORY**: After completing ANY task that produces new knowledge — fixing a bug, making a decision, discovering a pattern, finding a constraint — capture it in the knowledge base immediately. Every entry builds institutional memory that benefits all future sessions.

## When to Capture

| Event | What to Document | Type |
|-------|-----------------|------|
| Bug fixed | Root cause, fix applied, how to prevent | `fix` |
| Technical decision made | Choice, reasoning, discarded alternatives | `decision` |
| Pattern identified | Convention, where used, why | `pattern` |
| Limitation found | Constraint, impact, workarounds | `constraint` |
| Unexpected behavior | The gotcha, workaround, why it happens | `gotcha` |

## How to Call

```
mcp__ai-knowledge__addKnowledge({
  content: "Description of what was learned",
  type: "fix" | "decision" | "pattern" | "constraint" | "gotcha",
  scope: "global" | "workspace:<project-name>",
  source: "Where this was discovered",
  tags: ["relevant", "tags"],
  confidenceScore: 0.9
})
```

### Examples

**Fix discovered:**
```
mcp__ai-knowledge__addKnowledge({
  content: "PostgreSQL pgvector extension requires CREATE EXTENSION before creating vector columns.",
  type: "fix",
  scope: "workspace:knowledge-base",
  source: "database migration debugging",
  tags: ["postgresql", "pgvector", "migration"],
  confidenceScore: 0.95
})
```

**Decision made:**
```
mcp__ai-knowledge__addKnowledge({
  content: "Chose all-minilm (384 dimensions) over nomic-embed-text for embeddings. 3x faster, lower memory.",
  type: "decision",
  scope: "workspace:knowledge-base",
  source: "embedding model selection",
  tags: ["ollama", "embeddings"],
  confidenceScore: 0.9
})
```

## Rules

- **All agents must capture** — no exceptions
- **Capture immediately** — do not wait until end of session
- **Never fix without documenting** — root cause and prevention are required
- **Never decide without documenting** — future agents need reasoning
- **Be concise but complete** — full context without re-investigation needed
- **All entries in English** — regardless of user language preference

## Update Existing Knowledge, Don't Duplicate

**CRITICAL**: Before calling `addKnowledge`, check if a related entry already exists from your initial query:

1. If yes → **UPDATE it** with `mcp__ai-knowledge__updateKnowledge(id, { content, tags })` instead of creating a new entry
2. If the existing entry is wrong → **DELETE it** with `mcp__ai-knowledge__deleteKnowledge(id)` and create a fresh one
3. Only **ADD** when the knowledge is genuinely new — no existing entry covers the topic

Duplicates pollute search results. One well-maintained entry is worth more than three stale duplicates.

## Scope Guidelines

| Scope | When |
|-------|------|
| `workspace:<project>` | Knowledge specific to one project |
| `global` | Cross-project knowledge |
