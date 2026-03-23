---
description: "Capture knowledge after completing tasks"
---

# cognistore-capture

Before finishing, save what you learned:

```
mcp__cognistore__addKnowledge({
  title, content, tags,
  type: "pattern|decision|fix|constraint|gotcha",
  scope, source,
  planId: "<your-plan-id>"
})
```

Always pass planId. Update existing entries instead of duplicating. All entries in English.

## Pre-Capture Check
Before capturing knowledge, ensure any active plan tasks are marked completed.
