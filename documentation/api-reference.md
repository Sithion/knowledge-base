# API Reference (Fastify Sidecar)

## Overview

The Fastify sidecar server exposes a REST API consumed by the React frontend. It runs on `localhost:3210+` (dynamic port) and is only accessible locally.

**File:** `apps/dashboard/server/index.ts`

## Health & Status

### GET /api/health

Check database and Ollama connectivity.

**Response:**
```json
{
  "database": { "connected": true, "path": "~/.ai-knowledge/knowledge.db" },
  "ollama": { "connected": true, "host": "http://localhost:11434" }
}
```

### GET /api/setup/status

Check if all setup components are installed and ready.

**Response:**
```json
{
  "node": true,
  "ollama": true,
  "database": true,
  "model": true,
  "mcpConfig": true,
  "sdkReady": true
}
```

## Knowledge CRUD

### GET /api/knowledge/recent

List recent knowledge entries.

| Query Param | Type | Default | Description |
|-------------|------|---------|-------------|
| `limit` | number | 20 | Max entries to return |

**Response:** `KnowledgeEntry[]`

### POST /api/knowledge/search

Semantic search across knowledge entries.

**Body:**
```json
{
  "query": "React performance optimization",
  "tags": ["react"],
  "type": "pattern",
  "scope": "workspace:my-project",
  "limit": 10,
  "threshold": 0.3
}
```

All fields except `query` are optional.

**Response:** `{ entry: KnowledgeEntry, similarity: number }[]`

### GET /api/knowledge/:id

Get a single entry by ID.

**Response:** `KnowledgeEntry`

### POST /api/knowledge

Create a new knowledge entry.

**Body:**
```json
{
  "content": "Use React.memo for expensive list items",
  "tags": ["react", "performance", "memo"],
  "type": "pattern",
  "scope": "global",
  "source": "code-review",
  "confidenceScore": 0.9,
  "agentId": "claude-code"
}
```

Required: `content`, `tags`, `type`, `scope`, `source`

**Response:** `KnowledgeEntry`

### PUT /api/knowledge/:id

Update an existing entry. Only include fields to change.

**Body:**
```json
{
  "content": "Updated content",
  "tags": ["new", "tags"]
}
```

**Response:** `KnowledgeEntry`

### DELETE /api/knowledge/:id

Delete an entry and its embedding.

**Response:** `{ success: true }`

## Statistics & Metrics

### GET /api/stats

Aggregated entry counts.

**Response:**
```json
{
  "total": 150,
  "byType": [
    { "type": "pattern", "count": 45 },
    { "type": "fix", "count": 38 }
  ],
  "byScope": [
    { "scope": "global", "count": 80 },
    { "scope": "workspace:my-app", "count": 70 }
  ]
}
```

### GET /api/metrics

Detailed metrics for the stats dashboard.

**Response:**
```json
{
  "database": { "size": "2.4 MB", "path": "~/.ai-knowledge/knowledge.db" },
  "activity": { "last24h": 12, "last7d": 45 },
  "activityByDay": [
    { "date": "2026-03-17", "count": 8 },
    { "date": "2026-03-16", "count": 4 }
  ],
  "heatmap": [
    { "date": "2026-03-17", "count": 8 },
    { "date": "2025-12-18", "count": 0 }
  ],
  "typeDistribution": [
    { "type": "pattern", "count": 45 }
  ]
}
```

- `activityByDay`: Last 15 days of activity
- `heatmap`: Last 90 days (daily counts for contribution heatmap)

### GET /api/tags

List all unique tags.

**Response:** `string[]`

## Setup Endpoints

### POST /api/setup/node

Install or detect Node.js v20.

### POST /api/setup/ollama

Install Ollama (brew on macOS, curl on Linux).

### POST /api/setup/ollama-start

Start `ollama serve` as background daemon. Waits up to 15 seconds for readiness.

### POST /api/setup/database

Create SQLite database with schema and indices.

### POST /api/setup/model

Pull `all-minilm` embedding model via Ollama API.

### POST /api/setup/configure

Inject MCP configs, instruction markers, and AI skills into all supported clients.

### POST /api/setup/complete

Finalize setup and re-initialize the SDK.

## Uninstall

### POST /api/uninstall

Full teardown: remove configs, skills, data, Ollama, and self-delete app. See [Setup & Uninstall](./setup-uninstall.md) for details.

## Error Handling

### Degraded Mode (503)

If the SDK fails to initialize on startup, the server enters degraded mode:

- All knowledge endpoints return `503 Service Unavailable`
- Setup and health endpoints remain available
- SDK re-initialization retried every 10 seconds
- Once SDK initializes, all endpoints become available

### Standard Error Response

```json
{
  "error": "Entry not found",
  "statusCode": 404
}
```
