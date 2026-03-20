<!-- COGNISTORE:BEGIN -->
## Knowledge Base Integration (cognistore)

> **BLOCKING REQUIREMENT** — You MUST follow these rules on EVERY task. No exceptions.
> Tools are provided by the `cognistore` MCP server.

### CHECKPOINT 1: Query First

**STOP. Before you read any file, write any code, or make any decision:**

```
mcp__cognistore__getKnowledge(query: "<describe the task or problem>")
```

- Similarity > 0.50: **Use directly** — skip redundant analysis
- Similarity 0.30–0.50: **Review** — combine with fresh analysis
- No results or < 0.30: Proceed with full analysis

### CHECKPOINT 2: Capture Last

**Before finishing, capture what you learned:**

```
mcp__cognistore__addKnowledge({
  content: "<what was learned>",
  tags: ["tag1", "tag2"],
  type: "pattern|decision|fix|constraint|gotcha",
  scope: "global" or "workspace:<project-name>",
  source: "<origin>"
})
```

If an existing entry covers the topic, **UPDATE it** instead of creating a duplicate.

### CHECKPOINT 3: Plan via createPlan

**ALL plans MUST be persisted in the knowledge base:**

```
mcp__cognistore__createPlan({
  title: "<plan title>",
  content: "<full plan>",
  tags: ["..."], scope: "workspace:<project>", source: "<context>",
  tasks: [{ description: "Step 1", priority: "high" }, ...]
})
```

- **ALWAYS** include a `tasks` array
- **ALWAYS** track execution: `updatePlanTask(taskId, {status: 'in_progress'})` BEFORE each task, `updatePlanTask(taskId, {status: 'completed', notes: '...'})` AFTER
- **ALWAYS** set plan to `active` when starting, `completed` when all tasks done

### Rules

1. **NEVER skip the knowledge query** — costs ~30 tokens; missing a hit wastes 2,000–8,000 tokens.
2. **All entries MUST be in English** — regardless of conversation language.
3. **Update, don't duplicate** — update existing entries when the topic already exists.
4. **Only store high-value knowledge** — non-obvious insights, not trivial fixes or standard docs.
5. **Plans MUST be in the knowledge base** — `createPlan()` with tasks array, track execution via `updatePlanTask()`.
<!-- COGNISTORE:END -->
