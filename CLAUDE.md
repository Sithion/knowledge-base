# CogniStore - Agent Rules

## Architecture (v1.0.4 — App-first, Docker-free)

- **Entry point**: Tauri desktop app (macOS .dmg, Linux .AppImage/.deb)
- **Database**: SQLite + sqlite-vec (file at `~/.cognistore/knowledge.db`)
- **Embeddings**: Ollama native (auto-installed by app on first launch)
- **Dashboard**: Tauri app (webview + Fastify sidecar)
- **MCP Server**: `@cognistore/mcp-server` npm package (only npm package remaining)
- **CLI**: Deprecated (removed in v0.6.0)
- **Docker**: Removed entirely

## Setup / Uninstall Symmetry (MANDATORY)

The Tauri app's setup wizard creates resources; the uninstall button must remove them.

**Rule:** If setup creates, copies, injects, or modifies anything, uninstall MUST remove or revert it.

| Setup action | Uninstall action |
|---|---|
| Create `~/.cognistore/` directory | Remove directory recursively |
| Create `~/.cognistore/knowledge.db` (SQLite + schema) | Removed with directory |
| Install Ollama via brew/curl | Uninstall Ollama via brew uninstall or remove binary |
| Start `ollama serve` | Stop `ollama serve` via pkill |
| Pull embedding model via Ollama API | Remove model via `ollama rm` |
| Inject `~/.claude/CLAUDE.md` markers | Remove markers via ConfigManager |
| Inject `~/.github/copilot-instructions.md` markers | Remove markers via ConfigManager |
| Inject `~/.copilot/copilot-instructions.md` markers | Remove markers via ConfigManager |
| Inject `~/.config/opencode/AGENTS.md` markers | Remove markers via ConfigManager |
| Add `cognistore` to `~/.claude/mcp-config.json` | Remove entry via ConfigManager |
| Add `cognistore` to `~/.claude.json` | Remove entry via ConfigManager |
| Add `cognistore` to `~/.copilot/mcp-config.json` | Remove entry via ConfigManager |
| Add `cognistore` to `~/.config/opencode/opencode.json` | Remove entry via ConfigManager |
| Inject read-only tool permissions in `~/.claude/settings.json` | Remove permission entries via ConfigManager |
| Copy Claude skills to `~/.claude/skills/cognistore-*/` | Remove skill directories |
| Copy Copilot skills to `~/.copilot/skills/cognistore-*/` | Remove skill directories |
| App installed in /Applications/ (macOS) | Self-delete via rmSync |

## Development Rules (MANDATORY)

### Upgrade Scripts
Every feature that changes **any** of the following MUST include an upgrade script that runs automatically when the app updates:
- **Database schema** → add a `.sql` migration file in `packages/core/src/db/migrations/{version}.sql`
- **Skills/hooks** → the upgrade system re-copies all templates on version change (no extra work needed)
- **Agent instructions** → re-injected automatically on version change
- **MCP configs** → re-written automatically on version change

The upgrade system (`/api/upgrade/run`) compares `~/.cognistore/.version` with the running app version. On mismatch, it re-deploys all artifacts.

### Patch Notes
Every change MUST update `PATCH-NOTES.md` at the project root. Group entries by version and category (features, fixes, improvements). This file is linked from README.md.

### Testing
Every new feature should have corresponding tests in `packages/tests/`. The test suite runs on CI for every PR and feature branch push.

## Path Resolution

The Tauri sidecar sets environment variables for the Fastify server:
- `SQLITE_PATH` — path to SQLite database
- `OLLAMA_HOST` — Ollama API endpoint
- `DASHBOARD_DIST_PATH` — path to bundled frontend assets
- `TEMPLATES_PATH` — path to bundled skills/config templates

## Configuration

CogniStore's runtime config schema (`SDKConfig`, in `packages/shared/src/types/config.ts`) groups settings into three sections:

| Section | Field | Default | Env override |
|---|---|---|---|
| `database` | `path` | `~/.cognistore/knowledge.db` | `SQLITE_PATH` |
| `ollama` | `host` | `http://localhost:11434` | `OLLAMA_HOST` |
| `ollama` | `model` | `nomic-embed-text` | `OLLAMA_MODEL` |
| `ollama` | `dimensions` | `256` | `EMBEDDING_DIMENSIONS` |
| `aiStack` | `enableSbOrchestration` | `false` | `COGNISTORE_ENABLE_SB_ORCHESTRATION` |
| `aiStack` | `secondBrainPath` | _unset_ | `COGNISTORE_SECOND_BRAIN_PATH` |
| `aiStack` | `contextEngineRepos` | `[]` | `COGNISTORE_CONTEXT_ENGINE_REPOS` (comma- or semicolon-separated list) |
| `aiStack` | `secondBrainRemote` | _unset_ | `COGNISTORE_SECOND_BRAIN_REMOTE` |
| `aiStack.intakePipeline` | `intakeModel` | `auto` | `COGNISTORE_INTAKE_MODEL` |
| `aiStack.intakePipeline` | `prCutModel` | `auto` | `COGNISTORE_PR_CUT_MODEL` |
| `aiStack.intakePipeline` | `intakeTimeoutSeconds` | `1800` | `COGNISTORE_INTAKE_TIMEOUT_SECONDS` |
| `aiStack.intakePipeline` | `prCutTimeoutSeconds` | `600` | `COGNISTORE_PR_CUT_TIMEOUT_SECONDS` |
| `aiStack.intakePipeline` | `workspaceDir` | `${appDataDir}/second-brain-workspace` | `COGNISTORE_INTAKE_WORKSPACE_DIR` |
| `aiStack.intakePipeline` | `prCutBaseBranch` | `develop` | `COGNISTORE_PR_CUT_BASE_BRANCH` |

### `aiStack` — AI Knowledge Stack POC (opt-in)

Added by the `ai-stack-poc-cognistore` openspec change. Wires CogniStore into a three-layer stack:

1. **Second Brain** (canonical source of truth — git-backed markdown DRs/specs at `secondBrainPath`)
2. **CogniStore** (this app — runtime mirror, ephemeral session memory)
3. **Context Engine** (per-repo `.ai/` scaffold for code-aware retrieval; one entry per repo in `contextEngineRepos`)

`enableSbOrchestration` is the master flag. **Default `false` — existing deployments see no behavior change.** When `true`:

- The layer-precedence system knowledge entry is upserted (idempotent, see `packages/core/src/services/protocol-hierarchy.ts`).
- Future SB-orchestration MCP tools (`secondBrain.*`, wave 3) and dashboard panels (`/second-brain`, `/context-engine`, wave 4+) become active.
- The `UserPromptSubmit` hook injection includes layer-precedence guidance.

Existing users are prompted exactly once on the first launch after upgrade ("Enable AI Knowledge Stack integration? Requires Second Brain checkout"); persisted via `~/.cognistore/.ai-stack-poc-migration.json`.

### `aiStack.intakePipeline` — managed-clone intake/PR pipeline

Added by the `ai-stack-poc-cognistore-intake-pipeline` openspec change. Drives the **Process Inbox → Review Diff → Open PR** flow against a CogniStore-owned managed clone at `${aiStack.intakePipeline.workspaceDir}` (default `${appDataDir}/second-brain-workspace/`), distinct from the user's personal `secondBrainPath`.

- `secondBrainRemote` is required to bootstrap the managed clone on first run; `git clone` (not `gh repo clone`) is used so `gh auth` is only needed when Phase B opens the draft PR.
- `intakeModel` / `prCutModel` flow into `copilot --model` for Phase A and Phase B respectively. Defaults are `auto` (the Rust bridge resolves to the curated catalog).
- All intake commands no-op when `enableSbOrchestration` is `false`.

```ts
aiStack: {
  enableSbOrchestration: true,
  secondBrainPath: '~/AcuityTech/Second Brain',
  secondBrainRemote: 'https://github.com/your-org/second-brain.git',
  intakePipeline: {
    intakeModel: 'auto',          // or e.g. 'claude-opus-4.6'
    prCutModel: 'auto',           // or e.g. 'gpt-5.4-mini'
    intakeTimeoutSeconds: 1800,   // 30 min
    prCutTimeoutSeconds: 600,     // 10 min
    prCutBaseBranch: 'develop',   // override for testing
  },
}
```
