---
description: "Create and track CogniStore plans for multi-step tasks"
---

# cognistore-plan

For tasks with 2+ steps, create a plan and track execution.

```
mcp__cognistore__createPlan({
  title, content, tags, scope, source,
  tasks: [{ description: "Step 1" }, ...],
  relatedKnowledgeIds: ["<ids>"]
})
```

Track each task:
- Before: `updatePlanTask(taskId, { status: "in_progress" })`
- After: `updatePlanTask(taskId, { status: "completed" })`

Plan auto-activates on first task start. Auto-completes when all tasks done.

## After Delegation
When subagent work completes:
1. `listPlanTasks(planId)` — check statuses
2. `updatePlanTask(taskId, {status: 'completed'})` for finished tasks
