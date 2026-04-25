## ADDED Requirements

### Requirement: Vendored Context Engine templates
The system SHALL ship a pinned snapshot of Context Engine's deployable templates under `cognistore/templates/context-engine/`.

#### Scenario: Vendored bundle present
- **WHEN** the CogniStore repository is checked out
- **THEN** `cognistore/templates/context-engine/` SHALL contain a complete copy of the Context Engine `.ai/` scaffold, the bootstrap and setup scripts, `requirements-context.txt`, and a `VERSION` file recording the upstream Context Engine git SHA used to produce the snapshot

#### Scenario: Vendored files are read-only by convention
- **WHEN** a contributor edits a file under `cognistore/templates/context-engine/` without bumping `VERSION`
- **THEN** a CI check SHALL fail the PR with a message pointing to `npm run vendor:context-engine`

### Requirement: Re-vendor command
The system SHALL provide an `npm run vendor:context-engine` command that copies templates from a configured Context Engine source path and updates `VERSION`.

#### Scenario: Standard re-vendor
- **WHEN** a maintainer runs `npm run vendor:context-engine`
- **THEN** the script SHALL copy the current `.ai/` and `scripts/` content from the configured Context Engine path, write the upstream SHA into `templates/context-engine/VERSION`, and stage all changes for commit

#### Scenario: Source path missing
- **WHEN** the configured Context Engine source path does not exist
- **THEN** the script SHALL exit non-zero with a message indicating the expected path and how to override it via env var

### Requirement: stack.init MCP tool
The system SHALL expose an MCP tool `stack.init({ repoPath, sbProject? })` that bootstraps Context Engine into a target repo using the vendored templates.

#### Scenario: Init on a clean repo
- **WHEN** `stack.init({ repoPath: "/path/to/repo" })` is called and the repo has no `.ai/index/`
- **THEN** the tool SHALL copy templates into `<repoPath>/.ai/`, copy bootstrap scripts into `<repoPath>/scripts/` (or merge if scripts directory exists), invoke `setup_context_engine.sh` to create the Python venv, and return a result object containing `{ initialized: true, version: "<vendored-version>", venvPath, paths: [...] }`

#### Scenario: Init with --sb-project
- **WHEN** `stack.init({ repoPath, sbProject: "cantina" })` is called
- **THEN** the tool SHALL additionally pull Second Brain–derived context per the `sb-derived-context-bootstrap` capability

#### Scenario: Init on already-initialized repo
- **WHEN** `stack.init` is called against a repo with an existing `.ai/index/`
- **THEN** the tool SHALL no-op and return `{ initialized: false, reason: "already-initialized", existingVersion: "..." }` — the operator must call `stack.upgrade` to refresh

### Requirement: File ownership and conflict policy
The system SHALL classify every file under `<repoPath>/.ai/` and `<repoPath>/scripts/` into one of four ownership categories, and `stack.init` / `stack.upgrade` SHALL honor these categories.

| Category | Examples | `stack.init` on new repo | `stack.init` on repo with file present | `stack.upgrade` |
|---|---|---|---|---|
| **vendored-owned** | `.ai/index/build_index.py`, `.ai/index/summarize.py`, `.ai/mcp/server.py`, `scripts/setup_context_engine.sh`, `scripts/bootstrap_real_repo.sh`, `requirements-context.txt` | install from vendored snapshot | abort init with `{ initialized: false, reason: "conflict", conflictingPaths: [...] }` unless `--adopt` flag is passed (which overwrites and warns) | overwrite from vendored snapshot |
| **user-owned** | `.ai/memory/decisions.log`, `.ai/index/.last-build`, `.ai/context/sb-derived/**`, `.ai/.no-context-engine` | create empty/skip | leave untouched | leave untouched |
| **mergeable** | `.ai/config.toml`, `.ai/AGENTS.md`, `.gitignore` (only if the bundle's snippet is absent) | install vendored default | three-way merge: keep user keys, add missing vendored keys, never remove user keys | three-way merge with same rules |
| **never-touched** | every file outside `.ai/`, `scripts/`, and `requirements-context.txt`; `.git/` always | n/a | n/a | n/a |

The vendored snapshot SHALL ship a manifest (`templates/context-engine/MANIFEST.json`) enumerating every vendored-owned and mergeable path. Files inside `.ai/` or `scripts/` that are NOT in the manifest SHALL be treated as **user-owned by default** — `stack.init`/`stack.upgrade` SHALL leave them untouched and SHALL list them under `result.preservedUnknown` for operator visibility. Backup files (`*.bak`, `*~`, `*.orig`) and editor temp files (`.#*`, `*.swp`) follow the same default.

#### Scenario: stack.init on a pristine repo
- **WHEN** the repo has no `.ai/` directory and no relevant `scripts/`
- **THEN** every vendored-owned file SHALL be created from the snapshot, every user-owned file SHALL be created empty (or omitted), every mergeable file SHALL be installed from the vendored default

#### Scenario: stack.init detects a hand-installed Context Engine
- **WHEN** the repo already has `.ai/index/build_index.py` (a vendored-owned file) and `--adopt` is NOT passed
- **THEN** the tool SHALL exit non-zero with `{ initialized: false, reason: "conflict", conflictingPaths: ["<repoPath>/.ai/index/build_index.py", ...] }` and SHALL print a remediation hint pointing at `--adopt` or `stack.upgrade`

#### Scenario: stack.init with --adopt on a partially-installed repo
- **WHEN** `stack.init({ repoPath, adopt: true })` is called and conflicts are detected
- **THEN** vendored-owned files SHALL be overwritten, user-owned files SHALL be left untouched, mergeable files SHALL be merged per the three-way rule, and the result SHALL include `{ initialized: true, adopted: true, overwrittenPaths: [...], preservedPaths: [...], preservedUnknown: [...] }`

#### Scenario: stack.upgrade encounters an unknown file inside a managed directory
- **WHEN** the repo contains `.ai/skills/my-custom-skill.md` (not in `MANIFEST.json`) and `stack.upgrade` runs
- **THEN** the file SHALL be left untouched, listed under `result.preservedUnknown`, and SHALL NOT block the upgrade

#### Scenario: stack.upgrade preserves user-owned content
- **WHEN** `stack.upgrade` is called on a repo with a non-empty `.ai/memory/decisions.log` and existing `.ai/context/sb-derived/`
- **THEN** both SHALL remain untouched; only vendored-owned files SHALL be overwritten and mergeable files SHALL be merged

### Requirement: Python prerequisite preflight
The system SHALL check Python availability before attempting venv creation, and SHALL surface a structured failure result when prerequisites are not met.

#### Scenario: python3 missing from PATH
- **WHEN** `stack.init` runs and `python3` is not on `PATH`
- **THEN** the tool SHALL exit with `{ initialized: false, reason: "missing-prerequisite", missing: "python3", remediation: "Install Python 3.10+ via brew/apt/...; see docs/context-engine-prerequisites.md" }` BEFORE copying any files

#### Scenario: python3 too old
- **WHEN** the resolved `python3 --version` reports < 3.10
- **THEN** the tool SHALL exit with `{ initialized: false, reason: "version-too-old", found: "<version>", required: "3.10+", remediation: "..." }`

#### Scenario: Non-Linux/macOS host, interactive caller
- **WHEN** the host OS is detected as Windows (`process.platform === "win32"`) AND the caller is interactive (TTY available, e.g., `stack.init` invoked from a CLI shell)
- **THEN** the tool SHALL prompt the user with a one-time confirmation: "Context Engine is tested on macOS and Linux. Continue on Windows? [y/N]"; default is no

#### Scenario: Non-Linux/macOS host, non-interactive caller (MCP / CI)
- **WHEN** the host OS is Windows and the caller is non-interactive (no TTY, e.g., `stack.init` invoked via MCP from CogniStore's auto-prompt hook, or in CI)
- **THEN** the tool SHALL exit with `{ initialized: false, reason: "unsupported-platform-confirmation-required", platform: "win32", remediation: "Re-invoke with stack.init({ allowUnsupportedPlatform: true }) to acknowledge the platform is untested" }` and SHALL NOT prompt

#### Scenario: Non-Linux/macOS host with explicit override
- **WHEN** `stack.init({ repoPath, allowUnsupportedPlatform: true })` is called on Windows
- **THEN** the platform check SHALL pass through with a warning logged in `result.warnings: ["running on untested platform: win32"]` and init proceeds

#### Scenario: Disk space below threshold
- **WHEN** the target volume has less than 500MB free (heuristic for venv + embedding model)
- **THEN** the tool SHALL exit with `{ initialized: false, reason: "low-disk", availableMb: <n>, requiredMb: 500 }`

### Requirement: First-run venv creation UX
The system SHALL provide visible progress and graceful failure during the first venv creation and dependency install.

#### Scenario: pip install times out
- **WHEN** `pip install -r requirements-context.txt` does not complete within 10 minutes
- **THEN** the tool SHALL kill the subprocess and return `{ initialized: false, reason: "pip-timeout", remediation: "Re-run with stack.init({ pipTimeout: <larger> }) or check network" }`

#### Scenario: pip install fails
- **WHEN** pip exits non-zero
- **THEN** the tool SHALL surface stderr verbatim (truncated to 4KB) in the result, leave the partial venv in place for inspection, and NOT mark success

#### Scenario: Embedding model download starts
- **WHEN** the first invocation triggers `sentence-transformers` model download (~200MB)
- **THEN** the tool SHALL stream model-download progress lines to the caller's stdout (or to a structured log file when invoked from MCP)

#### Scenario: Operator is offline at first run
- **WHEN** pip cannot reach PyPI
- **THEN** the tool SHALL exit with `{ initialized: false, reason: "network-offline", remediation: "Run when online; the model download is one-time and ~200MB" }`

### Requirement: stack.upgrade MCP tool
The system SHALL expose an MCP tool `stack.upgrade({ repoPath })` that refreshes templates over an existing installation while preserving local content.

#### Scenario: Upgrade with template-only changes
- **WHEN** vendored templates are newer than what the target repo has and the operator calls `stack.upgrade`
- **THEN** the tool SHALL overwrite scripts and `.ai/index/*.py` and `.ai/mcp/*.py` and `.ai/skills/<context-engine>/*` from the vendored snapshot, SHALL leave `.ai/memory/decisions.log` and `.ai/index/.last-build` and any `.ai/context/sb-derived/` content untouched, and SHALL return `{ upgraded: true, fromVersion, toVersion, filesUpdated: [...] }`

#### Scenario: Upgrade when already on current version
- **WHEN** the target repo's installed version matches the vendored version
- **THEN** the tool SHALL return `{ upgraded: false, reason: "already-current", version }` without touching files

### Requirement: stack.status MCP tool
The system SHALL expose `stack.status({ repoPath })` reporting installation state.

#### Scenario: Repo with installation
- **WHEN** the repo has Context Engine installed
- **THEN** the response SHALL include `{ installed: true, version, vendoredVersion, drift: <bool>, lastBuild: <ISO timestamp or null>, sbDerivedPresent: <bool> }`

#### Scenario: Repo without installation
- **WHEN** the repo has no `.ai/index/`
- **THEN** the response SHALL be `{ installed: false }`

### Requirement: Auto-detect hook
The system SHALL run a `ContextEngineDetect` hook at session start that prompts the user when Context Engine is not installed in the CWD repo.

#### Scenario: Working in a repo without Context Engine
- **WHEN** the agent session begins, the CWD is inside a git repo, `.ai/index/` does not exist, the env var `CI` is unset, the file `.ai/.no-context-engine` does not exist, and `cognistore.config.contextEnginePromptDisabled` is not true
- **THEN** the hook SHALL prompt the user with a single message: "Context Engine is not set up in <repo>. Initialize now? [Y/n/never]" — `Y` calls `stack.init`, `n` skips for this session, `never` writes `.ai/.no-context-engine` and skips for all future sessions

#### Scenario: Already initialized
- **WHEN** `.ai/index/` exists in the CWD
- **THEN** the hook SHALL NOT prompt

#### Scenario: Opt-out marker present
- **WHEN** `.ai/.no-context-engine` exists
- **THEN** the hook SHALL NOT prompt regardless of other conditions

#### Scenario: Running in CI
- **WHEN** the `CI` environment variable is set to any truthy value
- **THEN** the hook SHALL NOT prompt

#### Scenario: Multiple session events
- **WHEN** the hook has already run once in the current session
- **THEN** subsequent invocations SHALL NOT re-prompt

### Requirement: Source of truth discipline
Context Engine source code SHALL remain canonical in `~/AcuityTech/ai-projects/` (per `ai-stack-poc-context-engine`); CogniStore vendors a pinned snapshot only.

#### Scenario: Drift detection in CI
- **WHEN** a PR modifies any file under `cognistore/templates/context-engine/` other than `VERSION`
- **THEN** CI SHALL fail and reference `npm run vendor:context-engine` as the correct workflow
