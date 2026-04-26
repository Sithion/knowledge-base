## ADDED Requirements

### Requirement: Second Brain panel renders project tree
The system SHALL provide a dashboard route `/second-brain` that renders a file-tree of `${secondBrainPath}/01-Projects/` and the contents of selected files.

#### Scenario: Panel opened with a configured path
- **WHEN** the user navigates to `/second-brain` with a valid `secondBrainPath`
- **THEN** the panel SHALL render projects collapsed by default; expanding a project SHALL show its `00-inbox / 01-sources / 02-analysis / 03-decisions / 04-specs` subdirectories

#### Scenario: User selects a markdown file
- **WHEN** the user clicks a markdown artifact in the tree
- **THEN** the panel SHALL render the body using the existing knowledge-entry markdown renderer and SHALL display frontmatter as a structured "Metadata" sidebar

#### Scenario: User clicks a `derived_from` link in the metadata sidebar
- **WHEN** the user clicks a `derived_from` entry referencing another artifact id
- **THEN** the panel SHALL navigate to that artifact and render it (same panel, no full reload)

#### Scenario: Open in editor button
- **WHEN** the user clicks "Open in editor" for any rendered artifact
- **THEN** the system SHALL invoke the configured editor command with the artifact's absolute path

#### Scenario: secondBrainPath not configured
- **WHEN** the user navigates to `/second-brain` with no `secondBrainPath`
- **THEN** the panel SHALL render an empty-state with a "Configure Second Brain" link to settings

### Requirement: Context Engine panel surfaces per-repo status
The system SHALL provide a dashboard route `/context-engine` that lists configured Context Engine repos and their index status.

#### Scenario: Panel opened with configured repos
- **WHEN** the user navigates to `/context-engine` with `contextEngineRepos: [<paths>]`
- **THEN** each repo SHALL render as a card showing: repo name, last-build timestamp (read from `.ai/index/.last-build` or equivalent), # of decisions logged, # of indexed files

#### Scenario: User searches the dep graph
- **WHEN** the user enters a query in a repo card's "Search dep-graph" input
- **THEN** the system SHALL call Context Engine's `context_deps neighbors` MCP tool against that repo and render results inline

#### Scenario: User clicks Re-index
- **WHEN** the user clicks "Re-index" on a repo card
- **THEN** the system SHALL spawn `${repo}/.ai/index/build_index.py` (using the repo's configured Python venv if any) and stream stdout to a log pane in the card; on completion the timestamp SHALL refresh

#### Scenario: User adds a new repo
- **WHEN** the user clicks "Add repo" and selects a folder
- **THEN** the system SHALL validate `${folder}/.ai/` exists; if it does the path SHALL be appended to `contextEngineRepos`; if not the system SHALL prompt with "This folder has no Context Engine setup. See bootstrap docs."

#### Scenario: contextEngineRepos is empty
- **WHEN** the user navigates to `/context-engine` with no configured repos
- **THEN** the panel SHALL show an explainer + link to bootstrap documentation

### Requirement: Unified search returns segmented results
The system SHALL provide a top-level search bar that fans out to all three layers in parallel and returns results grouped by source.

#### Scenario: User submits a query
- **WHEN** the user enters a query and presses Enter
- **THEN** the system SHALL kick off three parallel queries: CogniStore semantic search, ripgrep over Second Brain markdown, `context_retrieve` per configured CE repo

#### Scenario: Results render
- **WHEN** results return from any source
- **THEN** they SHALL render in a labeled section `[CS] CogniStore`, `[SB] Second Brain`, or `[CE] Context Engine`, top 5 per section

#### Scenario: Slow source
- **WHEN** one source takes longer than another
- **THEN** the faster sources SHALL render immediately while the slow one shows a per-section spinner

#### Scenario: Source error
- **WHEN** any source errors
- **THEN** that section SHALL show an inline error message; other sections SHALL render normally

#### Scenario: Click a result
- **WHEN** the user clicks a result
- **THEN** CS results SHALL navigate to the existing knowledge view, SB results SHALL navigate to `/second-brain` and select the file, CE results SHALL invoke the configured editor at the file path

### Requirement: Health pane and stack-wide status indicator
The system SHALL provide a `/health` route and a status-bar element visible on all routes.

#### Scenario: Health pane renders
- **WHEN** the user navigates to `/health`
- **THEN** the panel SHALL show four indicators: Ollama state, last SB→CogniStore sync age, per-repo CE index age, hook injection self-test result

#### Scenario: One indicator goes red
- **WHEN** any of the four indicators crosses its red threshold (configurable per indicator)
- **THEN** the status-bar SHALL turn red and tooltip SHALL summarize the worst-of state

#### Scenario: Hook self-test
- **WHEN** the hook self-test runs
- **THEN** it SHALL write a test entry to `system:health` scope and verify the entry exists; entries older than 24h SHALL be GC'd
