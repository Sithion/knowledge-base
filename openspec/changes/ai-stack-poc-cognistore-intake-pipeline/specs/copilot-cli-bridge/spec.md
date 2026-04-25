# copilot-cli-bridge

Subprocess contract for spawning `copilot` CLI from CogniStore's Tauri backend, parsing JSONL streaming events, surfacing them to the UI, and managing the model catalog (since `copilot` provides no `--list-models` API).

## ADDED Requirements

### Requirement: Subprocess spawn invariants

CogniStore SHALL spawn `copilot` CLI as a child process via Tokio (`tokio::process::Command`) with these invariants on every invocation:

- `--output-format json` (always)
- `--allow-all-tools` (always — required for non-interactive operation)
- `--no-ask-user` (always — disables interactive prompts)
- `--add-dir <path>` (one or more, scoped to the managed clone and any session-specific staging dirs; **never `--allow-all-paths` or `--yolo`**)
- `--model <model-id>` (resolved from configuration or user dropdown)
- `--share <session-md-path>` (always — for audit trail)
- `--agent <agent-name>` (when invoking a specific agent like `mojito:second-brain`)
- `-p <prompt>` (the rendered prompt content)

CogniStore SHALL set the child's working directory to the managed clone path. Environment variables SHALL inherit from the parent except: `COPILOT_ALLOW_ALL` is explicitly set to `1`, no other Copilot-related env vars are passed unless the user has BYOK configured.

#### Scenario: Spawn never uses overly permissive flags

- **WHEN** CogniStore spawns `copilot` for any phase
- **THEN** the argv MUST NOT contain `--allow-all-paths`, `--yolo`, or `--allow-all-urls` unless the user has explicitly opted in via a future BYOK affordance
- **AND** the argv MUST contain `--add-dir <managedClone>` for path scoping

#### Scenario: Working directory is the managed clone

- **WHEN** CogniStore spawns `copilot`
- **THEN** the child process working directory is the managed Second Brain clone path
- **AND** the agent operates with the clone as its CWD reference

### Requirement: JSONL event streaming and parsing

CogniStore SHALL read child stdout line-by-line and parse each line as JSON. Each parsed object SHALL be classified into a typed event:

- `tool_call` — the agent is invoking a tool. Payload: `{tool: string, args: object}`.
- `tool_result` — a tool returned. Payload: `{tool: string, ok: boolean, summary: string}`.
- `text_delta` — incremental model text. Payload: `{content: string}`.
- `final_message` — the agent's final assistant message. Payload: `{content: string}`.
- `error` — Copilot CLI surfaced an error. Payload: `{message: string}`.
- `unknown` — JSON parsed but did not match a known event type. Payload: `{raw: object}`.

Each event SHALL be emitted as a Tauri event named `agent-transcript-event` with `{sessionId, eventType, data}` payload.

If a stdout line is not valid JSON, it SHALL be logged but SHALL NOT crash the parser. The parser SHALL be resilient to schema additions in future Copilot CLI versions (degrade to `unknown` event type).

#### Scenario: Tool call event renders in transcript

- **GIVEN** the agent invokes its `read_file` tool
- **WHEN** Copilot CLI emits `{"type":"tool_call","tool":"read_file","args":{"path":"..."}}`
- **THEN** CogniStore parses to `ToolCall { tool: "read_file", args: {...} }`
- **AND** emits `agent-transcript-event` to the UI
- **AND** the UI renders "📄 Reading file ..." in the transcript

#### Scenario: Unknown event type degrades gracefully

- **WHEN** Copilot CLI emits a JSON line of a future event type CogniStore doesn't recognize
- **THEN** CogniStore parses it as `Unknown { raw: <object> }`
- **AND** emits the event so the UI can render it as a generic "agent activity" entry
- **AND** the parser does not crash

### Requirement: Cross-platform process group lifecycle

CogniStore SHALL create the child process as the leader of a new process group/job object so that abort cleanly terminates the agent and any subprocesses it spawned (tools, shell commands).

- **macOS / Linux**: spawn with `setsid()` (via `Command::pre_exec`) so the child gets a new session and process group. Abort sends `SIGTERM` and then `SIGKILL` to `-pid` (the negative PID, targeting the whole group via `killpg`).
- **Windows**: spawn with the `CREATE_NEW_PROCESS_GROUP` creation flag and assign the child to a Job Object via `AssignProcessToJobObject`. Abort calls `TerminateJobObject` to kill the entire tree.

CogniStore SHALL register a process supervisor that polls each active session's PID at 1 Hz; if the parent CogniStore process exits, OS-level reclamation MUST take down the child (Job Object on Windows, parent-death on Linux via `prctl(PR_SET_PDEATHSIG)` where available; on macOS a best-effort polling supervisor is acceptable for the POC).

#### Scenario: Abort kills tools the agent spawned

- **GIVEN** the agent has spawned a long-running shell command via its tool surface
- **WHEN** the user clicks Abort
- **THEN** both the `copilot` parent and the shell child are terminated
- **AND** no zombie processes remain

#### Scenario: CogniStore crash does not leak children

- **GIVEN** Phase A is in progress and CogniStore is force-killed
- **WHEN** the OS reclaims the parent
- **THEN** on Windows, the Job Object terminates the child tree
- **AND** on Linux, `PDEATHSIG` terminates the child tree
- **AND** on macOS, the next CogniStore launch detects orphaned `copilot` processes via the lockfile + PID and surfaces them for cleanup

### Requirement: Stderr capture and surfacing

CogniStore SHALL capture child stderr in addition to stdout. Stderr lines SHALL be:

1. Written to `${appDataDir}/intake-sessions/<sessionId>/copilot-session-<phase>.stderr.log` for the audit trail.
2. Inspected for known error patterns (`401 Unauthorized`, `ENOTFOUND`, `model.+not.+found`, `agent.+not.+found`). When matched, CogniStore SHALL emit a high-priority `agent-transcript-event` with `eventType: "error"` so the UI can render it prominently.
3. NOT mixed into the JSONL stream parser — stderr is intentionally a separate channel.

If the child exits non-zero with empty stdout but non-empty stderr, CogniStore SHALL include the last 20 stderr lines in the user-facing error banner.

#### Scenario: Auth error on stderr surfaces clearly

- **GIVEN** Copilot CLI auth has expired
- **WHEN** Phase A is invoked
- **THEN** stderr contains a `401 Unauthorized` line
- **AND** the UI shows "Copilot CLI authentication expired. Run `copilot login` and re-check."

### Requirement: Subprocess abort

CogniStore SHALL provide an `abort_copilot(sessionId)` Tauri command that:

1. Sends `SIGTERM` to the child process group.
2. Waits up to 5 seconds for clean exit.
3. If still alive, sends `SIGKILL` to the child process group.
4. Marks the session as `aborted` in the audit log.

The UI SHALL surface an "Abort" button while a Phase A or Phase B run is in progress.

#### Scenario: User aborts a long-running intake

- **GIVEN** Phase A is in progress
- **WHEN** the user clicks Abort
- **THEN** SIGTERM is sent to the child
- **AND** if not exited within 5s, SIGKILL is sent
- **AND** the UI shows "Session aborted" with the partial transcript preserved

### Requirement: Model catalog with curated list and free-text fallback

CogniStore SHALL ship a curated model catalog at `cognistore/templates/copilot-models.json` with the following schema:

```json
{
  "version": "<iso-date>",
  "models": [
    { "id": "auto", "label": "Auto (Copilot routing)", "tier": "auto" },
    { "id": "gpt-5.4", "label": "GPT-5.4", "tier": "premium" },
    { "id": "gpt-5.4-mini", "label": "GPT-5.4 mini", "tier": "fast" },
    { "id": "claude-sonnet-4.6", "label": "Claude Sonnet 4.6", "tier": "premium" },
    { "id": "claude-haiku-4.5", "label": "Claude Haiku 4.5", "tier": "fast" },
    { "id": "gpt-4.1", "label": "GPT-4.1", "tier": "fast" }
  ]
}
```

The model dropdown for both **Intake Model** and **PR-Cut Model** SHALL populate from this catalog plus an **"Other (specify)…"** free-text option that accepts any string and passes it directly as `--model <user-input>`.

CogniStore SHALL NOT attempt to query `copilot --list-models` (this command does not exist). When GitHub adds a new model, the catalog MUST be refreshed via an app release. The free-text fallback covers the gap between releases.

#### Scenario: Dropdown populated from catalog

- **WHEN** the user opens the Intake Model selector
- **THEN** the dropdown shows the 6 catalog entries with tier labels
- **AND** an "Other (specify)…" option at the bottom

#### Scenario: Free-text model passes through

- **GIVEN** the user selects "Other (specify)…" and enters `claude-opus-4.6`
- **WHEN** Phase A runs
- **THEN** the spawn argv contains `--model claude-opus-4.6`

### Requirement: BYOK note

The model selector SHALL surface (as a small info icon next to "Other (specify)…") a note about BYOK support: "Custom providers via `COPILOT_PROVIDER_BASE_URL` env vars (Ollama, Azure, OpenAI-compatible). See Copilot CLI docs."

BYOK is **not** a primary UX target for the POC. Users wanting BYOK SHALL configure env vars in their shell environment; CogniStore SHALL inherit them. CogniStore SHALL NOT manage BYOK credentials in its own settings UI for the POC.

#### Scenario: BYOK env vars inherited

- **GIVEN** the user has `COPILOT_PROVIDER_BASE_URL=http://localhost:11434/v1` set in their shell when launching CogniStore
- **WHEN** CogniStore spawns `copilot`
- **THEN** the env var is inherited by the child
- **AND** Copilot CLI routes inference to the BYOK endpoint

### Requirement: Timeout and error handling

Each invocation SHALL have a configurable timeout. Defaults: `intakeTimeoutSeconds = 600` (10 min), `prCutTimeoutSeconds = 120` (2 min).

On timeout, CogniStore SHALL invoke abort (SIGTERM then SIGKILL) and surface a UI banner: "Intake timed out after N seconds. Last agent output: <truncated last text_delta>".

On non-zero exit, CogniStore SHALL surface a UI banner with the agent's last text output and exit code. The intake branch SHALL remain intact (not deleted) so the user can Reject or retry manually.

#### Scenario: Timeout surfaces last output

- **GIVEN** Phase A has been running 600 seconds
- **WHEN** the timeout fires
- **THEN** CogniStore aborts the subprocess
- **AND** the UI shows "Intake timed out after 600 seconds" with the last text_delta content

#### Scenario: Non-zero exit preserves branch

- **WHEN** Phase A exits with code 1
- **THEN** the intake branch is NOT deleted
- **AND** the user can Reject (which deletes the branch) or attempt Refine

### Requirement: Audit `--share` markdown always passed

Every `copilot` invocation (Phase A, Phase B, scaffold-project) SHALL include `--share ${appDataDir}/intake-sessions/<sessionId>/copilot-session-<phase>.md`. This produces a complete markdown record of the agent's session that survives independently of CogniStore's process lifecycle.

#### Scenario: Audit markdown captured for completed Phase A

- **GIVEN** Phase A completes (success, abort, or timeout)
- **WHEN** the subprocess exits
- **THEN** `${appDataDir}/intake-sessions/<sessionId>/copilot-session-phase-a.md` exists
- **AND** contains the full agent transcript per the `--share` format
