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

## Pre-Capture Check
Before capturing knowledge, ensure any active plan tasks are marked completed.
