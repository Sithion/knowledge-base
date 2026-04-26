# Project Context — CogniStore

## Purpose

CogniStore is a single-machine, semantic memory layer for AI coding agents. It runs as a Tauri desktop app + Fastify sidecar + bundled MCP server, backed by SQLite + sqlite-vec + Ollama-hosted embeddings. Agents query, capture, and plan via MCP tools (`getKnowledge`, `addKnowledge`, `createPlan`, `updatePlanTask`, …); humans browse via the dashboard webview.

In the **AI Stack POC** (active now), CogniStore is also positioned as the orchestrator in the middle of a three-layer stack: **Second Brain (canonical) > CogniStore (runtime mirror) > Context Engine (per-repo code-aware retrieval)**. CogniStore drives Second Brain's pipelines via shell-out, deploys Context Engine to repos via vendored templates, and provides a unified dashboard front door — without becoming a new source of truth.

## Tech Stack

- **Language**: TypeScript (strict mode), Rust (Tauri shell)
- **Workspace**: pnpm monorepo + Turborepo (`turbo.json`)
- **Packages**:
  - `packages/shared` — types, constants, defaults
  - `packages/core` — DB client, repositories, services, migrations
  - `packages/embeddings` — Ollama embedding client
  - `packages/sdk` — `KnowledgeSDK` (the public programmatic API)
  - `packages/config` — `ConfigManager` (template injection / MCP config wiring)
  - `packages/tests` — Playwright + integration tests
- **Apps**:
  - `apps/dashboard` — Tauri shell (`src-tauri/`) + Vite/React webview (`src/`) + Fastify sidecar (`server/`)
  - `apps/mcp-server` — `@cognistore/mcp-server` npm package (the only npm-published artifact)
- **Database**: SQLite (`~/.cognistore/knowledge.db`) + `sqlite-vec` extension. Schema migrations in `packages/core/src/db/migrations/`, also embedded in `packages/core/src/db/migrate.ts` for bundled MCP server use.
- **Embeddings**: Ollama, `nomic-embed-text` (Matryoshka), 256-dim default.
- **Build**: `pnpm install` → `pnpm build` (Turbo, all 8 workspaces).

## Project Conventions

### Code Style
- TypeScript strict mode; no implicit `any`
- Prefer narrow exported surfaces; deep imports stay package-private
- ESM throughout (`"type": "module"`)
- File extensions in import specifiers (`.js` for compiled, matches Node ESM resolution)

### Architecture Patterns
- Layered: `repository → service → SDK → (MCP tool | HTTP endpoint | Tauri IPC)`
- Embedding generation lives in the service layer; repositories are storage-only
- All cross-layer integrations (Second Brain scripts, Context Engine MCP) shell out via `child_process` — no direct imports across the runtime boundary
- Dashboard panels render content but never mutate source-of-truth files; mutations delegate to the owning system's normal entry points (PRs for Second Brain, build scripts for Context Engine)

### Setup / Uninstall Symmetry (MANDATORY)
Every artifact created during setup MUST have a corresponding removal step in uninstall (see root `CLAUDE.md`). New config keys, migration markers, vendored templates, and OS-level files all qualify.

### Testing Strategy
- Unit tests adjacent to source under `packages/<name>/src/**/*.test.ts`
- Integration / E2E tests in `packages/tests/` (Playwright)
- Fixture-driven for filesystem-touching code (e.g. SB orchestration MCP tools use `tests/fixtures/second-brain/`)

### Git Workflow
- Trunk: `main` (Raphael's upstream merge target)
- Active POC branch: `feature/ai-stack-poc` (local-only until the demo + Raphael conversation)
- Conventional commits (`feat(scope): …`, `fix(scope): …`, `docs(scope): …`)
- Do NOT push from agent sessions; commits stay local until human review

## Domain Context

### Three-layer knowledge stack (POC convention)
| Layer | Role | Storage | Authoring |
|---|---|---|---|
| Second Brain | Canonical, human-ratified DRs/specs | git-tracked markdown + `_graph.json` | editor + git PRs |
| CogniStore (this repo) | Runtime mirror + ephemeral session memory | SQLite + sqlite-vec | MCP tools + dashboard |
| Context Engine | Per-repo code-aware retrieval | per-repo `.ai/` (LlamaIndex + ChromaDB) | indexers + decision logs |

Precedence is a **soft norm injected via prompt guidance**, not a runtime-enforced arbitration rule. Conflict resolution is the agent's responsibility, informed by the convention.

### Knowledge entry types
`decision`, `pattern`, `fix`, `constraint`, `gotcha`, `system` — defined in `packages/core/src/db/schema/knowledge.ts`.

`system`-typed entries are surfaced by the `UserPromptSubmit` hook injection. Prefer adding new system entries (separate titles) over overwriting existing ones.

### Scope conventions
- `global` — applies repo-wide / cross-project
- `workspace:<project>` — scoped to a Second Brain project name (or any working-directory project)
- Strategic decisions captured under `workspace:<project>` are promotion-ready for Second Brain DR drafts; global-scope strategic decisions require operator-supplied `--project=<name>` at promotion time

## Important Constraints

- Single-user-per-machine; no multi-machine sync
- BSL 1.1 license — no third-party SaaS dependencies introduced
- Aaron's mandate: "authoring stays in editor + git." Dashboard panels are render-only for content; mutations delegate to PRs / build scripts / `stack.init`
- All Phase 1 hooks and tools are opt-in via `enableSbOrchestration` (default `false`). Existing CogniStore deployments without Second Brain see no behavior change.
- Rust toolchain on dev machines may lag behind Tauri's required version; prefer TS-only edits when possible. Cargo work is gated on toolchain upgrade.

## External Dependencies

- **Ollama** (auto-installed by setup wizard) — embedding host
- **Second Brain checkout** at `~/AcuityTech/Second Brain` (configurable via `secondBrainPath`) — only required when `enableSbOrchestration: true`
- **Context Engine repos** — listed via `contextEngineRepos`; CogniStore reads `.ai/` scaffolds and shells out to per-repo Python venvs

## Coordinated POC repos

- `~/AcuityTech/Second Brain/` — `ai-stack-poc-second-brain` change; exposes `_tools/ingest/run-pipeline.js`, `_tools/promote/from-cognistore.js`
- `~/AcuityTech/ai-projects/` — `ai-stack-poc-context-engine` change; source of truth for the Context Engine templates that `cognistore/templates/context-engine/` vendors
- See `~/AcuityTech/ai-projects/ai-tooling/KICKOFF.md` for cross-repo orchestration and Phase 1/2 acceptance gates
