---
description: "Create and track CogniStore plans for multi-step tasks"
---

# cognistore-plan

For tasks with 2+ steps, create a plan and track execution.

```
mcp__cognistore__createPlan({
  title, content: "<structured plan>", tags, scope, source,
  tasks: [{ description: "Step 1" }, ...],
  relatedKnowledgeIds: ["<ids>"]
})
```

### Required Plan Structure

The `content` field MUST include these sections:
- **## Context** — why this change is needed
- **## Approach** — how it will be implemented (architecture, data flow, key logic)
- **## Files to Modify** — table with file paths and what changes
- **## Verification** — how to test (commands, expected results)

Optional: **## Reusable Code**, **## Edge Cases & Risks**

Include file paths, function names, and specific technical details — not generic descriptions.

Track each task:
- Before: `updatePlanTask(taskId, { status: "in_progress" })`
- After: `updatePlanTask(taskId, { status: "completed" })`

Plan auto-activates on first task start. Auto-completes when all tasks done.

## After Delegation
When subagent work completes:
1. `listPlanTasks(planId)` — check statuses
2. `updatePlanTask(taskId, {status: 'completed'})` for finished tasks

---

## AI Stack POC — Second Brain traceability (when enabled)

When `cognistore.config.aiStack.enableSbOrchestration` is `true`, plans that implement work derived from a Second Brain Decision Record or spec MUST carry that linkage forward:

- Add a tag of the form `sb:DR-<id>` or `sb:spec-<slug>` (e.g. `sb:DR-2025-01-ai-stack`) to `createPlan({ tags: [...] })`.
- Reference the source DR/spec by relative path (from `secondBrainPath`) in the `## Context` section of the plan content (e.g. `Source: 03-decisions/DR-2025-01-ai-stack.md`).
- When capturing knowledge during execution (`addKnowledge`), pass through the same `sb:*` tag so future queries can trace runtime artifacts back to canonical source.

This keeps the Second Brain → CogniStore → Context Engine chain auditable: any plan or knowledge entry can be traced to the originating decision when the layered stack is in use.

When the flag is off (default), this section can be ignored.
