# MCP Server

## Overview

The MCP server (`@cognistore/mcp-server`) is the primary interface for AI coding agents. It exposes 14 tools via the [Model Context Protocol](https://modelcontextprotocol.io/) stdio transport. Published to npm as a standalone package.

**System knowledge guard:** Several tools enforce protection of system entries (`type=system`). System entries are seeded during setup and contain mandatory protocol instructions. They cannot be deleted or modified through MCP tools, and `addPlanRelation` silently skips them.

## Transport

```
AI Client ←── stdio (stdin/stdout JSON-RPC) ──→ MCP Server ──→ SDK ──→ SQLite + Ollama
```

The server is launched by AI clients via `npx -y @cognistore/mcp-server`. Communication happens over stdin/stdout using JSON-RPC messages per the MCP specification.

## Tools

### addKnowledge

Store a new knowledge entry with automatic semantic embedding. If `planId` is provided, an output relation is automatically created linking this entry to the plan (skipped for system entries).

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | string | Yes | — | Short descriptive title |
| `content` | string | Yes | — | The knowledge content text |
| `tags` | string[] | Yes | — | Categorical tags for filtering and embedding |
| `type` | enum | Yes | — | `decision`, `pattern`, `fix`, `constraint`, `gotcha`, or `system` |
| `scope` | string | Yes | — | `global` or `workspace:<project-name>` |
| `source` | string | Yes | — | Where this knowledge came from |
| `confidenceScore` | number | No | 1.0 | 0.0–1.0 confidence rating |
| `agentId` | string | No | — | ID of the creating agent |
| `planId` | string | No | — | Active plan ID — auto-creates an output relation linking this entry to the plan |

> **Note:** The `system` type is reserved for mandatory protocol entries seeded during setup. Agents should not create entries with `type=system` — these are managed exclusively by the setup wizard.

### getKnowledge

Search knowledge entries using semantic similarity. The response includes active plan detection — if an active plan exists, the response includes a reminder with the plan ID.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | — | Natural language search query |
| `tags` | string[] | No | — | Filter by tags (all must match) |
| `type` | enum | No | — | Filter by knowledge type |
| `scope` | string | No | — | Filter by scope (global always included) |
| `limit` | number | No | 10 | Maximum results to return |
| `threshold` | number | No | 0.7 | Minimum similarity score (0.0–1.0) |

### updateKnowledge

Update an existing entry. Re-embeds if tags change. Auto-increments version. Rejects type or content changes to system entries (`type=system`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | UUID of the entry to update |
| `title` | string | No | New title |
| `content` | string | No | New content text |
| `tags` | string[] | No | New tags (triggers re-embedding) |
| `type` | enum | No | New type |
| `scope` | string | No | New scope |
| `source` | string | No | New source |
| `confidenceScore` | number | No | New confidence score |

### deleteKnowledge

Remove an entry and its embedding by ID. Returns an error if the entry has `type=system` (system entries are protected and cannot be deleted).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | UUID of the entry to delete |

### listTags

List all unique tags across all knowledge entries. No parameters.

### healthCheck

Verify database connectivity and Ollama availability. No parameters. Returns status for both services.

### createPlan

Create a new plan with optional initial tasks and knowledge relations. Status starts as `draft`. The response includes a planId reminder: "Your active plan ID is X. Pass planId to addKnowledge calls."

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `title` | string | Yes | — | Plan title (short, descriptive) |
| `content` | string | Yes | — | Full plan content (steps, approach, considerations) |
| `tags` | string[] | Yes | — | Tags for categorization |
| `scope` | string | Yes | — | `global` or `workspace:<project-name>` |
| `source` | string | Yes | — | Source/context of the plan |
| `relatedKnowledgeIds` | string[] | No | — | IDs of knowledge entries consulted during planning (creates input relations) |
| `tasks` | object[] | No | — | Initial tasks with `description` and optional `priority` (`low`/`medium`/`high`) |

### updatePlan

Update an existing plan's title, content, tags, scope, status, or source. When status is set to `active`, the response includes a planId reminder: "Your active plan ID is X. Pass planId to addKnowledge calls."

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `planId` | string | Yes | UUID of the plan to update |
| `title` | string | No | New title |
| `content` | string | No | New content |
| `tags` | string[] | No | New tags |
| `scope` | string | No | New scope |
| `status` | enum | No | `draft`, `active`, or `completed` (agents cannot set `archived` — archiving is a user-only action via the dashboard) |
| `source` | string | No | New source |

### addPlanRelation

Link a knowledge entry to a plan as input or output. Silently skips system knowledge entries (`type=system`) — no error is returned, but no relation is created.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `planId` | string | Yes | UUID of the plan |
| `knowledgeId` | string | Yes | UUID of the knowledge entry to link |
| `relationType` | enum | Yes | `input` (consulted during planning) or `output` (created during execution) |

### addPlanTask

Add a task to a plan's todo list. Position is auto-calculated.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `planId` | string | Yes | — | UUID of the plan |
| `description` | string | Yes | — | Task description |
| `priority` | enum | No | `medium` | `low`, `medium`, or `high` |
| `notes` | string | No | — | Optional notes |

### updatePlanTask

Update a plan task's status, description, priority, or notes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | UUID of the task |
| `status` | enum | No | `pending`, `in_progress`, or `completed` |
| `description` | string | No | New description |
| `priority` | enum | No | `low`, `medium`, or `high` |
| `notes` | string/null | No | Notes about progress or blockers |

### listPlanTasks

List all tasks for a plan, ordered by position. Use to check progress or resume work. The response includes a planId reminder for convenience.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `planId` | string | Yes | UUID of the plan |

### addKnowledgeBatch

Create multiple knowledge entries at once. Each entry supports the same parameters as `addKnowledge`, including optional `planId` for auto-linking entries as plan outputs.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entries` | object[] | Yes | Array of entry objects, each with: `title`, `content`, `tags`, `type`, `scope`, `source`, and optionally `planId`, `confidenceScore` |

Each entry in the array follows the same schema as `addKnowledge`. Returns an array of created entries.

### updatePlanTasks

Update multiple plan tasks at once (batch status changes). Useful for marking several tasks as completed or in_progress in a single call.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `updates` | object[] | Yes | Array of update objects, each with: `taskId` (required), `status` (optional) |

Each update object follows the same schema as `updatePlanTask`. Returns an array of updated tasks.

## Tool Annotations

Tools are annotated with hints for MCP clients:

| Annotation | Tools | Purpose |
|------------|-------|---------|
| `readOnlyHint: true` | `getKnowledge`, `listTags`, `healthCheck`, `listPlanTasks` | Signals the tool does not modify state |
| `destructiveHint: true` | `deleteKnowledge` | Signals the tool permanently removes data |

## MCP Resources

The server exposes one resource template:

### `cognistore://context/{scope}`

Auto-loaded resource that provides scope-aware knowledge base context. Returns:
- Recent knowledge entries for the given scope
- Active plans in the scope
- All available tags

Clients that support MCP resources can subscribe to this for automatic context loading.

## Plan Status Guards

The service layer enforces plan lifecycle consistency:

- **Auto-activate**: When any task moves to `in_progress`, the plan automatically transitions from `draft` to `active`
- **Auto-complete tasks**: When a plan is set to `completed`, all pending/in_progress tasks auto-complete
- **Reactivation**: If a task is updated on a `completed` plan, the plan reactivates to `active`

These guards prevent orphaned states (e.g., tasks `in_progress` but plan still `draft`).

## Bundling Strategy

**File:** `apps/mcp-server/tsup.config.ts`

The MCP server uses **tsup** to create a single ESM bundle that inlines all workspace packages:

**Inlined (bundled):**
- `@cognistore/sdk`
- `@cognistore/core`
- `@cognistore/embeddings`
- `@cognistore/shared`

**External (resolved at runtime via node_modules):**
- `better-sqlite3` (native addon)
- `sqlite-vec` (native addon)
- `drizzle-orm`
- `@modelcontextprotocol/sdk`
- `zod`

This means `npx -y @cognistore/mcp-server` installs only the external dependencies — the workspace code is pre-bundled.

## Configuration

The MCP server reads configuration from environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SQLITE_PATH` | `~/.cognistore/knowledge.db` | Database file path |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `all-minilm` | Embedding model |
| `EMBEDDING_DIMENSIONS` | `384` | Vector dimensions |

## Client Configuration

### Claude Code

```json
// ~/.claude/mcp-config.json
{
  "mcpServers": {
    "cognistore": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cognistore/mcp-server"]
    }
  }
}
```

### GitHub Copilot

```json
// ~/.copilot/mcp-config.json
{
  "mcpServers": {
    "cognistore": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cognistore/mcp-server"]
    }
  }
}
```

### OpenCode

```json
// ~/.config/opencode/opencode.json
{
  "mcp": {
    "cognistore": {
      "type": "local",
      "command": ["npx", "-y", "@cognistore/mcp-server"],
      "enabled": true
    }
  }
}
```
