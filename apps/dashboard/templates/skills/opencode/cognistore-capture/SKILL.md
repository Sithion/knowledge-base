---
description: "Capture knowledge after completing tasks"
---

# cognistore-capture

Before finishing, save what you learned:

```
mcp__cognistore__addKnowledge({
  title: "Descriptive title for semantic search",
  content, tags,
  type: "pattern|decision|fix|constraint|gotcha",
  scope, source,
  planId: "<your-plan-id>"
})
```

- Always pass `planId` and a descriptive `title` (powers semantic search)
- Dedup is automatic — similar entries in same scope+type are updated, not duplicated
- **Prefer `scope: "global"`** for language/framework/tool insights that apply beyond this project
- All entries in English

## Pattern Checklist

Before finishing, check: did you discover any reusable **pattern** about a language, framework, library, or tool? If yes, store it with `type: "pattern"`, `scope: "global"`. Patterns compound across every future project.

## Pre-Capture Check
Before capturing knowledge, ensure any active plan tasks are marked completed.

---

## AI Stack POC — Strategic capture guidance (when enabled)

When `cognistore.config.aiStack.enableSbOrchestration` is `true`, capture content with the layered stack in mind:

- **Cross-project decisions, architecture, or specs** → these belong in **Second Brain** (canonical). Don't store them as `addKnowledge` entries with `scope: "global"`. Instead, surface a note in your reply that the user should promote it to a Decision Record / spec; CogniStore is the *mirror*, not the source of truth for these.
- **Patterns, gotchas, fixes, and operational notes** → keep using `addKnowledge` with `type: pattern | fix | gotcha`. These are CogniStore-native.
- **Per-repo context** (architecture diagrams, in-repo decision logs, dependency notes) → these belong in the **context engine** for that repo. Don't duplicate them globally in CogniStore.
- **Tags:** add `ai-stack-poc` and one of `layer:second-brain | layer:cognistore | layer:context-engine` when the layer placement is non-obvious, so future queries can distinguish.

When in doubt: if the knowledge would be useful to *another project* without modification, it probably belongs in Second Brain. If it's only meaningful in *this repo*, it belongs in the context engine. CogniStore covers the middle ground (cross-task, single-developer, runtime).

When the flag is off (default), this section can be ignored — capture in CogniStore as usual.
