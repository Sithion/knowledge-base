## ADDED Requirements

### Requirement: System knowledge entry documents layer precedence (POC convention)
The system SHALL maintain a `type: system, scope: global` knowledge entry titled "AI Knowledge Stack — Layer precedence (POC convention)" that documents the Second Brain > CogniStore > Context Engine precedence convention. The entry SHALL state explicitly that this is a soft norm injected via prompt guidance, NOT a runtime-enforced arbitration rule — agents may consult any layer, and conflict resolution is an agent-level decision informed by the convention.

#### Scenario: enableSbOrchestration flips to true on a fresh install
- **WHEN** the user enables `enableSbOrchestration` and no precedence entry exists
- **THEN** the system SHALL upsert the canonical entry text (defined in design.md §System Knowledge Entry)

#### Scenario: enableSbOrchestration flips back to false
- **WHEN** the user disables `enableSbOrchestration`
- **THEN** the system SHALL retain the entry but stop injecting it via the `UserPromptSubmit` hook

### Requirement: UserPromptSubmit hook injects layered protocol guidance
The system SHALL extend the existing `UserPromptSubmit` hook to include layered-protocol guidance whenever `enableSbOrchestration` is true. The injected text SHALL frame the precedence as a convention to follow, not as an enforced rule, and SHALL NOT claim the system arbitrates conflicts on the agent's behalf.

#### Scenario: Agent submits a prompt while flag is on
- **WHEN** any AI agent calls into CogniStore via the MCP server with `enableSbOrchestration` true
- **THEN** the injected protocol SHALL include: (a) the standard `getKnowledge()` first directive, (b) `if .ai/mcp/server.py exists in CWD also call context_retrieve`, (c) `prefer Second Brain DR/spec content over CogniStore entries when conflicts arise — this is a convention, exercise judgment`

#### Scenario: Agent submits a prompt while flag is off
- **WHEN** the flag is off
- **THEN** the injected protocol SHALL NOT include the layered-protocol additions; existing protocol behavior SHALL be unchanged

### Requirement: Skill documents reflect the hierarchy
The system SHALL update the three CogniStore-bundled skills (`cognistore-query`, `cognistore-capture`, `cognistore-plan`) to reference the layered-protocol convention.

#### Scenario: cognistore-query is loaded
- **WHEN** an agent loads the `cognistore-query` skill
- **THEN** the skill content SHALL contain a "Layer precedence" section pointing at the system knowledge entry and noting the convention status

#### Scenario: cognistore-capture is loaded for a strategic decision
- **WHEN** an agent loads `cognistore-capture` and is about to record a decision
- **THEN** the skill content SHALL prompt: "Is this strategic? If yes, capture under `scope: workspace:<project>` OR add tag `project:<name>` so the entry can later be promoted to a Second Brain DR via `secondBrain.promoteDecision`. Global-scope strategic entries cannot be promoted without operator-supplied `--project`."

#### Scenario: cognistore-plan is loaded
- **WHEN** an agent loads `cognistore-plan` for a task that mentions a Second Brain project name
- **THEN** the skill content SHALL prompt: "Call `secondBrain.lookupTraceability` to inform the plan with DR/source provenance."

### Requirement: One-time opt-in prompt
The system SHALL prompt existing users on the next CogniStore upgrade after this change is shipped, exactly once, asking whether to enable the AI Knowledge Stack integration.

#### Scenario: First launch after upgrade
- **WHEN** an existing user starts CogniStore for the first time after upgrading to a version that includes this change
- **THEN** the system SHALL display a one-time dialog: "Enable AI Knowledge Stack integration? (Requires Second Brain checkout)" with [Enable / Not Now / Configure Path]

#### Scenario: User chooses "Not Now"
- **WHEN** the user dismisses the prompt with "Not Now"
- **THEN** `enableSbOrchestration` SHALL remain false and the prompt SHALL NOT re-appear automatically; the user can flip the flag in settings later

#### Scenario: User chooses "Enable" but Second Brain is not at the default path
- **WHEN** the user enables and the default `~/AcuityTech/Second Brain` does not exist
- **THEN** the system SHALL prompt for a custom path before completing enablement
