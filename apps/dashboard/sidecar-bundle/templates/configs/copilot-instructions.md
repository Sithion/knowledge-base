<!-- COGNISTORE:BEGIN -->
## Knowledge Base Integration (cognistore)

> **Your workflow** — Follow these 4 steps on every task automatically.
> Tools are provided by the `cognistore` MCP server.

### 1. Search First

Before you read any file, write any code, or make any decision:

```
mcp__cognistore__getKnowledge(query: "<describe the task>")
```

Save any returned entry IDs — you need them for createPlan.

### 2. Plan Multi-Step Tasks

If the task has 2+ steps, create a plan:

```
mcp__cognistore__createPlan({
  title, content, tags, scope, source,
  tasks: [{ description: "Step 1" }, ...],
  relatedKnowledgeIds: ["<ids-from-step-1>"]
})
```

Save the returned **planId** — you need it in step 4.

Track each task:
- Before starting: `mcp__cognistore__updatePlanTask(taskId, { status: "in_progress" })`
- After finishing: `mcp__cognistore__updatePlanTask(taskId, { status: "completed" })`
- Plan activates automatically when the first task starts
- Plan completes automatically when all tasks are done

### 3. Do the Work

Execute the user's task.

### 4. Save What You Learned

Before finishing, capture discoveries:

```
mcp__cognistore__addKnowledge({
  title, content, tags,
  type: "pattern|decision|fix|constraint|gotcha",
  scope: "global" or "workspace:<project>",
  source: "<origin>",
  planId: "<your-plan-id>"
})
```

Always pass planId if you have an active plan.
Update existing entries instead of creating duplicates.
All entries in English.

### After Delegation
When delegated work completes, reconcile:
1. `mcp__cognistore__listPlanTasks(planId)` — check statuses
2. `mcp__cognistore__updatePlanTask(taskId, { status: "completed" })` for finished tasks
<!-- COGNISTORE:END -->
