# first-run-setup

Detect-and-fix flow for `copilot` CLI prerequisites. Targets PMs who may not have `copilot`, `gh`, or the `mojito:second-brain` agent installed/authenticated. Gates only the intake feature, not the entire app.

## ADDED Requirements

### Requirement: Prerequisite probe runs at app launch and view-open

On app launch and on Project Workspace view open, CogniStore SHALL invoke (in parallel, non-blocking) a multi-tier probe set. Probes are split into **availability** (does the binary work?) and **smoke** (does an end-to-end no-op succeed?). Smoke probes only run when all availability probes pass.

**Availability probes** (always run):

- `copilot --version`
- `gh --version`
- `gh auth status` (authentication, not just install)
- `git --version`

**Smoke probes** (only when availability passes):

- **Copilot auth + agent end-to-end**: spawn `copilot --no-ask-user --allow-all-tools --output-format json --add-dir <tmp> --agent mojito:second-brain -p "Reply with the exact word OK and nothing else."` against a temporary scratch directory. PASS iff (a) the subprocess exits 0 within 30 seconds and (b) the final assistant message contains `OK`. This single probe simultaneously verifies: `copilot` runs, login is valid, `mojito:second-brain` agent resolves, and JSONL parsing works.

Each probe SHALL have a 10-second timeout (30 seconds for the smoke probe). Results SHALL be cached for the duration of the app session and refreshed on user-initiated Re-check.

The brittle `copilot --agent mojito:second-brain --help` probe is **NOT** used; the smoke probe replaces it.

#### Scenario: Smoke probe distinguishes "installed" from "logged in"

- **GIVEN** `copilot --version` succeeds (binary present)
- **AND** the user's Copilot login is expired
- **WHEN** the smoke probe runs
- **THEN** the smoke probe fails (subprocess returns non-zero with auth error on stderr)
- **AND** the diagnostics modal shows "Copilot is installed but login is expired. Run `copilot login`."

#### Scenario: All prerequisites pass

- **GIVEN** all availability and smoke probes succeed
- **WHEN** the user opens the Project Workspace view
- **THEN** the Process Inbox button is enabled
- **AND** no Setup Required banner is shown

#### Scenario: Probes run in parallel

- **WHEN** prerequisite probing kicks off
- **THEN** all availability probes start concurrently
- **AND** total wall-clock time approximates the slowest probe, not the sum
- **AND** smoke probes start only after availability passes

### Requirement: Setup Required banner gates intake-only

If any probe fails, CogniStore SHALL:

- Disable the **Process Inbox** button (and "+ New Project") with a tooltip explaining the missing prerequisite.
- Surface a non-blocking "Setup Required" banner above the Project Workspace view with text "Intake is unavailable. Install missing tools." and an "Open Setup Diagnostics" affordance.
- Leave all other CogniStore functionality (knowledge query, plans, base dashboard, knowledge capture, etc.) fully functional.

#### Scenario: Missing copilot disables intake only

- **GIVEN** `copilot --version` fails
- **WHEN** the user opens CogniStore
- **THEN** the Process Inbox button is disabled with tooltip "Copilot CLI not installed"
- **AND** the knowledge query view, plans view, and base dashboard remain fully functional
- **AND** a Setup Required banner appears in the Project Workspace view

#### Scenario: Missing gh auth disables intake

- **GIVEN** `gh auth status` reports unauthenticated
- **WHEN** the user opens the Project Workspace view
- **THEN** the Process Inbox button is disabled with tooltip "GitHub CLI not authenticated"

#### Scenario: Missing mojito agent disables intake

- **GIVEN** the smoke probe fails because `copilot --agent mojito:second-brain` cannot resolve the agent
- **WHEN** the user opens the Project Workspace view
- **THEN** the Process Inbox button is disabled with tooltip "mojito:second-brain agent not installed"

### Requirement: Diagnostics modal with OS-aware install guides

The Diagnostics modal SHALL show:

- Live status of all 5 probes (✅ / ❌ / ⏳)
- For each failed probe, an OS-specific install snippet
- A **Re-check** button that re-runs all probes
- A **Test intake against sample-bot** button (visible only when all probes pass) that runs a no-op intake against the `sample-bot` project to validate the full pipeline before real use

OS detection SHALL use Tauri's `os` plugin. Install snippets SHALL be sourced from `cognistore/templates/intake-setup-guide.md` and rendered into the modal.

The install snippets SHALL cover at minimum:

**macOS**:
```sh
brew install gh
npm install -g @github/copilot
gh auth login
copilot login
# Install the mojito plugin per Acuity team docs
```

**Windows**:
```powershell
winget install GitHub.cli
# Install Node.js if missing: winget install OpenJS.NodeJS
npm install -g @github/copilot
gh auth login
copilot login
# Install the mojito plugin per Acuity team docs
```

**Linux**: best-effort guidance pointing to upstream docs (not gated for the POC).

#### Scenario: Modal shows live probe results

- **WHEN** the user opens Setup Diagnostics
- **THEN** all 5 probes are visible with current status
- **AND** failed probes show the relevant OS install snippet

#### Scenario: Re-check refreshes after fix

- **GIVEN** the user installed `gh` from the modal's snippet
- **WHEN** they click Re-check
- **THEN** all probes re-run
- **AND** the `gh --version` row updates to ✅

#### Scenario: Test against sample-bot validates pipeline

- **GIVEN** all probes pass
- **WHEN** the user clicks Test intake against sample-bot
- **THEN** CogniStore creates a synthetic session with one `.txt` file containing "hello world"
- **AND** runs Phase A
- **AND** shows the resulting diff (likely empty or trivial)
- **AND** prompts the user to Reject (no PR is opened)

### Requirement: mojito:second-brain agent availability

The `mojito:second-brain` agent is loaded via the user's installed Mojito Copilot plugin. CogniStore SHALL NOT vendor a fallback copy of the agent definition for the POC. If the agent is missing, the diagnostics modal SHALL link to the Mojito plugin install instructions (sourced from team docs).

If a future demo reveals high friction with plugin installation, OQ-1 in the design doc revisits vendoring a fallback.

#### Scenario: Missing plugin shows install link

- **GIVEN** the `mojito:second-brain` probe fails
- **WHEN** the diagnostics modal opens
- **THEN** the row shows a link "Install Mojito Copilot plugin" pointing to team docs
