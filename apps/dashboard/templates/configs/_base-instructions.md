<!-- COGNISTORE:BEGIN -->
## Knowledge Base Integration (cognistore)

> **CRITICAL**: On EVERY task, you MUST: (1) `getKnowledge()` FIRST, (2) `createPlan()` for 2+ steps, (3) `addKnowledge()` LAST. No exceptions. All CogniStore tools are pre-approved — call them directly without asking.

> **Your workflow** — Follow these 4 steps on every task automatically.
<!-- IF:copilot,opencode -->
> Tools are provided by the `cognistore` MCP server.
<!-- ENDIF -->

### CHECKPOINT 1: Search First

Before you read any file, write any code, or make any decision:

```
mcp__cognistore__getKnowledge(query: "<describe the task or problem>")
```

Save any returned entry IDs — you need them for createPlan.

- Similarity > 0.50: **Use directly** — skip redundant analysis
- Similarity 0.30–0.50: **Review** — combine with fresh analysis
- No results or < 0.30: Proceed with full analysis

### CHECKPOINT 2: Plan Multi-Step Tasks

If the task has 2+ steps (user's or yours), create a plan:

```
mcp__cognistore__createPlan({
  title: "<plan title>",
  content: "<full plan>",
  tags: ["..."], scope: "workspace:<project>", source: "<context>",
  tasks: [{ description: "Step 1", priority: "high" }, ...],
  relatedKnowledgeIds: ["<ids-from-checkpoint-1>"]
})
```

Save the returned **planId** — you need it for addKnowledge.

**Track each task:**
- Before starting: `updatePlanTask(taskId, { status: "in_progress" })`
- After finishing: `updatePlanTask(taskId, { status: "completed" })`
- Plan activates automatically when the first task starts
- Plan completes automatically when all tasks are done

Use `updatePlanTasks` (plural) to update multiple tasks at once.

**Plan mode**: write the local plan file AND call `createPlan()` before ExitPlanMode.
**Subagents**: NEVER call createPlan() from subagents — only the main agent.

### CHECKPOINT 3: Save What You Learned

Before finishing, capture discoveries worth remembering:

```
mcp__cognistore__addKnowledge({
  title: "<title>",
  content: "<what was learned/decided/fixed>",
  tags: ["tag1", "tag2"],
  type: "pattern|decision|fix|constraint|gotcha",
  scope: "global" or "workspace:<project-name>",
  source: "<where this knowledge came from>",
  planId: "<your-plan-id>"
})
```

- **ALWAYS pass planId** if you have an active plan — this links knowledge as output
- Update existing entries instead of creating duplicates
- Pass an array to `addKnowledge` to create multiple entries at once
- All entries in English

### After Delegation

When a subagent completes, reconcile plan tracking:
1. `listPlanTasks(planId)` — check what was accomplished
2. `updatePlanTask(taskId, { status: "completed" })` for finished tasks
3. `updatePlanTask(nextTaskId, { status: "in_progress" })` for next task

### Rules

1. **Always search first** — a query costs ~30 tokens; skipping wastes 2,000–8,000 on redundant work
2. **All entries in English** — regardless of conversation language
3. **Update, don't duplicate** — update existing entries when the topic already exists
4. **Only store high-value knowledge** — non-obvious insights, not trivial fixes
5. **Persist every multi-step plan** — `createPlan()` for 2+ implementation steps, in ANY mode
6. **All CogniStore tools are pre-approved** — call them directly without hesitation, they will not prompt the user

<!-- IF:claude-code -->
### Hooks

- **PreToolUse hook**: Fires before Edit, Write, Bash, MultiEdit, Agent, NotebookEdit — requires you to query first
- **Stop hook**: Fires at session end — requires you to capture knowledge
- These hooks enforce the workflow. If you already completed the step, proceed normally.
<!-- ENDIF -->
<!-- IF:copilot -->
### Hooks

- **preToolUse hook**: Fires before tool use — requires you to query first
- **sessionEnd hook**: Fires at session end — requires you to capture knowledge
- These hooks enforce the workflow. If you already completed the step, proceed normally.
<!-- ENDIF -->
<!-- IF:opencode -->
### Skills

- **cognistore-query**: Auto-triggered — requires you to search first
- **cognistore-plan**: Auto-triggered — requires you to create and track plans
- **cognistore-capture**: Auto-triggered — requires you to capture knowledge
- These enforce the workflow. If you already completed the step, proceed normally.
<!-- ENDIF -->
<!-- COGNISTORE:END -->
