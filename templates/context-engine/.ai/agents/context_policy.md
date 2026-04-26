# Context Policy

## Rules
- Never dump the full repository into prompt context.
- Always retrieve relevant context before generation.
- Prefer summaries, contracts, and decision logs before raw code.
- Expand code context using dependency relationships only when justified.
- Restrict edits to retrieved files and directly relevant neighbors where possible.
- Summarize completed work after each task.

## Retrieval Order
1. `.ai/context/*` — architecture, standards, contracts, domain model
2. `.ai/summaries/*` — module summaries, repo summary
3. `.ai/memory/*` — decisions, bugs, patterns
4. Retrieved code files (via semantic search)
5. Dependency-expanded nearby files (depth-limited)

## Prohibited Behavior
- Full repo scans as prompt input
- Unrelated file edits
- Creating new conventions without documenting them
- Ignoring prior decisions recorded in `.ai/memory/decisions.log`

## Integration with OhMyOpenAgent
- Role policies are defined in `role_policies.yaml` (context scoping)
- Role-to-agent mapping is in `llm_agents_map.yaml` (runtime routing)
- These files do NOT override OhMyOpenAgent's agent/model configuration
- They provide supplementary context rules for the retrieval pipeline
