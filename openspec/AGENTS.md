# OpenSpec Instructions (CogniStore)

Instructions for AI coding assistants using OpenSpec for spec-driven development in this repo. Mirrors the conventions used across Aaron's other AcuityTech projects (e.g. `~/AcuityTech/ai-projects/PDM/openspec/AGENTS.md`).

## TL;DR Quick Checklist

- Search existing work: `openspec spec list --long`, `openspec list` (use `rg` only for full-text search)
- Decide scope: new capability vs modify existing capability
- Pick a unique `change-id`: kebab-case, verb-led (`add-`, `update-`, `remove-`, `refactor-`, `ai-stack-poc-` for the current POC)
- Scaffold: `proposal.md`, `tasks.md`, `design.md` (only if needed), and delta specs per affected capability
- Write deltas: use `## ADDED|MODIFIED|REMOVED|RENAMED Requirements`; include at least one `#### Scenario:` per requirement
- Validate: `openspec validate [change-id] --strict --no-interactive`
- Request approval: do not start implementation until the proposal is approved

## Three-Stage Workflow

### Stage 1: Creating Changes
Create a proposal when the work:
- Adds new capability (MCP tools, dashboard panels, hooks, lifecycle commands)
- Makes breaking changes (DB schema, MCP tool signatures, config schema)
- Changes architecture (new packages, cross-layer protocol)
- Updates security or persistence patterns

Skip a proposal for:
- Bug fixes that restore intended behavior
- Typos, formatting, comments
- Dependency bumps without behavior change
- Test additions for existing behavior

### Stage 2: Implementing Changes
1. Read `proposal.md` — what is being built
2. Read `design.md` if present — technical decisions
3. Read `tasks.md` — implementation checklist
4. Implement tasks sequentially; check off `- [x]` only after the task is truly done
5. Do not start implementation until the proposal is approved

### Stage 3: Archiving Changes
After deployment:
- Move `changes/[name]/` → `changes/archive/YYYY-MM-DD-[name]/`
- Update `specs/` if capabilities changed
- `openspec archive <change-id> --yes` (use `--skip-specs` for tooling-only changes)
- `openspec validate --strict --no-interactive` to confirm

## Before Any Task

**Context Checklist**
- [ ] Read relevant specs in `specs/[capability]/spec.md`
- [ ] Check pending changes in `changes/` for conflicts
- [ ] Read `openspec/project.md` for conventions
- [ ] Run `openspec list` to see active changes
- [ ] Run `openspec list --specs` to see existing capabilities

**Before Creating Specs**
- Check if the capability already exists; prefer modifying over duplicating
- Use `openspec show [spec]` to review current state
- If the request is ambiguous, ask 1–2 clarifying questions before scaffolding

## Directory Structure

```
openspec/
├── AGENTS.md               # This file — workflow instructions
├── project.md              # Project conventions (CogniStore-specific)
├── specs/                  # Current truth — what IS built
│   └── [capability]/
│       ├── spec.md         # Requirements + scenarios
│       └── design.md       # Technical patterns (optional)
├── changes/                # Proposals — what SHOULD change
│   ├── [change-id]/
│   │   ├── proposal.md     # Why, what, impact
│   │   ├── tasks.md        # Implementation checklist
│   │   ├── design.md       # Technical decisions (optional)
│   │   └── specs/
│   │       └── [capability]/
│   │           └── spec.md # ADDED/MODIFIED/REMOVED
│   └── archive/            # Completed changes
```

## Spec Delta Conventions

```markdown
## ADDED Requirements
### Requirement: New Feature
The system SHALL provide …

#### Scenario: Success case
- **WHEN** user performs action
- **THEN** expected result

## MODIFIED Requirements
### Requirement: Existing Feature
[Complete modified requirement text]

## REMOVED Requirements
### Requirement: Old Feature
**Reason**: …
**Migration**: …
```

If multiple capabilities are affected, create one delta file per capability under `changes/[change-id]/specs/<capability>/spec.md`.

## CogniStore-specific notes

- Active POC change: `ai-stack-poc-cognistore` (this repo's slice of the three-repo AI Stack POC). Sibling proposals live in `~/AcuityTech/ai-projects/openspec/changes/ai-stack-poc-context-engine/` and `~/AcuityTech/Second Brain/openspec/changes/ai-stack-poc-second-brain/`. Read all three together when reasoning about the protocol-hierarchy / sb-orchestration-mcp / dashboard-panels capabilities.
- Phase 1 work is opt-in via `cognistore.config.enableSbOrchestration` (default `false`). Existing users see no behavior change unless they flip the flag.
- Source-of-truth precedence: Second Brain (canonical) > CogniStore (runtime mirror) > Context Engine (per-repo). When specs conflict between layers, defer to Second Brain DRs/specs.
- Branch convention for the POC: `feature/ai-stack-poc`. Do not push from agent sessions; commits stay local until the human reviews.

## Search Guidance

- Enumerate specs: `openspec spec list --long` (or `--json` for scripts)
- Enumerate changes: `openspec list`
- Show details: `openspec show <spec-id> --type spec`, `openspec show <change-id> --json --deltas-only`
- Full-text search (use ripgrep): `rg -n "Requirement:|Scenario:" openspec/`
