# Database Layer

## Overview

The knowledge base uses **SQLite** with the **sqlite-vec** extension for vector similarity search. The database is managed through **Drizzle ORM** and stored as a single file at `~/.ai-knowledge/knowledge.db`.

## Schema

### knowledge_entries (relational table)

**File:** `packages/core/src/db/schema/knowledge.ts`

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | TEXT PK | UUIDv4 | Unique identifier |
| `content` | TEXT NOT NULL | — | Knowledge content (free text) |
| `tags` | TEXT NOT NULL | `'[]'` | JSON array of string tags |
| `type` | TEXT NOT NULL | — | One of: `decision`, `pattern`, `fix`, `constraint`, `gotcha` |
| `scope` | TEXT NOT NULL | — | `global` or `workspace:<project-name>` |
| `source` | TEXT NOT NULL | — | Origin of the knowledge (file, conversation, etc.) |
| `version` | INTEGER NOT NULL | `1` | Incremented on each update |
| `expires_at` | TEXT | NULL | ISO timestamp for TTL (optional) |
| `confidence_score` | REAL NOT NULL | `1.0` | 0.0–1.0 confidence rating |
| `related_ids` | TEXT | NULL | JSON array of related entry IDs |
| `agent_id` | TEXT | NULL | ID of the agent that created this entry |
| `created_at` | TEXT NOT NULL | — | ISO timestamp |
| `updated_at` | TEXT NOT NULL | — | ISO timestamp |

**Indices:**
- `idx_type` on `type`
- `idx_scope` on `scope`

### knowledge_embeddings (virtual table)

**File:** `packages/core/src/db/schema/sqlite-vec.ts`

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_embeddings
USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[384] distance_metric=cosine
);
```

This is a **sqlite-vec** virtual table that stores 384-dimensional float32 vectors with cosine distance metric. It supports KNN (k-nearest-neighbor) queries.

## Auto-Schema Creation

**File:** `packages/core/src/db/client.ts`

The `createDbClient()` function calls `ensureSchema()` which creates tables and indices if they don't exist. This means the MCP server can initialize from scratch without the setup wizard — the SDK will create the database and schema on first use.

```typescript
function ensureSchema(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_entries (...);
    CREATE INDEX IF NOT EXISTS idx_type ON knowledge_entries(type);
    CREATE INDEX IF NOT EXISTS idx_scope ON knowledge_entries(scope);
  `);
}
```

## SQLite Configuration

| Pragma | Value | Purpose |
|--------|-------|---------|
| `journal_mode` | `WAL` | Write-Ahead Logging for concurrent reads |
| `busy_timeout` | `5000` | Wait 5s before SQLITE_BUSY error |
| `foreign_keys` | `ON` | Enforce referential integrity |

## Vector Search Implementation

**File:** `packages/core/src/repositories/knowledge.repository.ts`

### Similarity Search Algorithm

```
Input: query vector (384-dim), options (scope, tags, type, limit, threshold)

1. KNN Phase (sqlite-vec):
   SELECT id, distance FROM knowledge_embeddings
   WHERE embedding MATCH ?
   ORDER BY distance
   LIMIT (limit * 5)  -- oversample for post-filtering

2. Post-Filter Phase (application layer):
   - Fetch full entries for KNN results
   - Filter by scope (requested scope + always include global)
   - Filter by tags (if specified, entry tags must include all query tags)
   - Filter by type (if specified)
   - Filter by expiration (exclude expired entries)
   - Convert: similarity = 1 - distance
   - Filter by threshold (default 0.3)
   - Sort by similarity descending
   - Limit to requested count

3. Return: [{ entry, similarity }]
```

### Why Tags Are Embedded (Not Content)

Tags serve as semantic anchors — they are concise, intentional descriptors chosen by the agent. Content can be arbitrarily long and noisy, which dilutes embedding quality. By embedding tags:

- Search queries like "React performance" match entries tagged with `react`, `performance`, `optimization`
- Short tag text produces more focused, discriminative embeddings
- The `all-minilm` model (optimized for short text) performs better on tags than on paragraphs

### Embedding Generation

**File:** `packages/embeddings/src/client.ts`

```
Input: tags array → join with space → "react performance hooks"
POST http://localhost:11434/api/embeddings
Body: { model: "all-minilm", prompt: "react performance hooks" }
Response: { embedding: [0.012, -0.045, ...] }  // 384 floats
```

## File Location

| Item | Path |
|------|------|
| Database file | `~/.ai-knowledge/knowledge.db` |
| WAL file | `~/.ai-knowledge/knowledge.db-wal` |
| SHM file | `~/.ai-knowledge/knowledge.db-shm` |

The parent directory `~/.ai-knowledge/` is created automatically by `createDbClient()` if it doesn't exist.
