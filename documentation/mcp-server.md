# MCP Server

## Overview

The MCP server (`@ai-knowledge/mcp-server`) is the primary interface for AI coding agents. It exposes 6 tools via the [Model Context Protocol](https://modelcontextprotocol.io/) stdio transport. Published to npm as a standalone package.

## Transport

```
AI Client ←── stdio (stdin/stdout JSON-RPC) ──→ MCP Server ──→ SDK ──→ SQLite + Ollama
```

The server is launched by AI clients via `npx -y @ai-knowledge/mcp-server`. Communication happens over stdin/stdout using JSON-RPC messages per the MCP specification.

## Tools

### addKnowledge

Store a new knowledge entry with automatic semantic embedding.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `content` | string | Yes | — | The knowledge content text |
| `tags` | string[] | Yes | — | Categorical tags for filtering and embedding |
| `type` | enum | Yes | — | `decision`, `pattern`, `fix`, `constraint`, or `gotcha` |
| `scope` | string | Yes | — | `global` or `workspace:<project-name>` |
| `source` | string | Yes | — | Where this knowledge came from |
| `confidenceScore` | number | No | 1.0 | 0.0–1.0 confidence rating |
| `agentId` | string | No | — | ID of the creating agent |

### getKnowledge

Search knowledge entries using semantic similarity.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | Yes | — | Natural language search query |
| `tags` | string[] | No | — | Filter by tags (all must match) |
| `type` | enum | No | — | Filter by knowledge type |
| `scope` | string | No | — | Filter by scope (global always included) |
| `limit` | number | No | 10 | Maximum results to return |
| `threshold` | number | No | 0.7 | Minimum similarity score (0.0–1.0) |

### updateKnowledge

Update an existing entry. Re-embeds if tags change. Auto-increments version.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | UUID of the entry to update |
| `content` | string | No | New content text |
| `tags` | string[] | No | New tags (triggers re-embedding) |
| `type` | enum | No | New type |
| `scope` | string | No | New scope |
| `source` | string | No | New source |
| `confidenceScore` | number | No | New confidence score |

### deleteKnowledge

Remove an entry and its embedding by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | UUID of the entry to delete |

### listTags

List all unique tags across all knowledge entries. No parameters.

### healthCheck

Verify database connectivity and Ollama availability. No parameters. Returns status for both services.

## Bundling Strategy

**File:** `apps/mcp-server/tsup.config.ts`

The MCP server uses **tsup** to create a single ESM bundle that inlines all workspace packages:

**Inlined (bundled):**
- `@ai-knowledge/sdk`
- `@ai-knowledge/core`
- `@ai-knowledge/embeddings`
- `@ai-knowledge/shared`

**External (resolved at runtime via node_modules):**
- `better-sqlite3` (native addon)
- `sqlite-vec` (native addon)
- `drizzle-orm`
- `@modelcontextprotocol/sdk`
- `zod`

This means `npx -y @ai-knowledge/mcp-server` installs only the external dependencies — the workspace code is pre-bundled.

## Configuration

The MCP server reads configuration from environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SQLITE_PATH` | `~/.ai-knowledge/knowledge.db` | Database file path |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `all-minilm` | Embedding model |
| `EMBEDDING_DIMENSIONS` | `384` | Vector dimensions |

## Client Configuration

### Claude Code

```json
// ~/.claude/mcp-config.json
{
  "mcpServers": {
    "ai-knowledge": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@ai-knowledge/mcp-server"]
    }
  }
}
```

### GitHub Copilot

```json
// ~/.copilot/mcp-config.json
{
  "mcpServers": {
    "ai-knowledge": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@ai-knowledge/mcp-server"]
    }
  }
}
```

### OpenCode

```json
// ~/.config/opencode/opencode.json
{
  "mcp": {
    "ai-knowledge": {
      "type": "local",
      "command": ["npx", "-y", "@ai-knowledge/mcp-server"],
      "enabled": true
    }
  }
}
```
