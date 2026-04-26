//! Spawn and supervise a `copilot` CLI subprocess.
//!
//! The high-level shape is:
//!
//! 1. Validate paths in [`CopilotArgs`] (reject early on missing dirs).
//! 2. Build the argv per the spec's invariants
//!    (`--output-format json --allow-all-tools --no-ask-user`, plus
//!    `--add-dir` for every scoped path, `--share <md>`,
//!    `--agent <a>`, `--model <m>`, `-p <prompt>`).
//! 3. Configure the child as a new process-group / job-object leader so
//!    abort kills the whole tree.
//! 4. Spawn, then drive three concurrent tasks:
//!    - stdout JSONL parser → `agent-transcript-event` events
//!    - stderr collector → both file-log and pattern-matched
//!      `agent-transcript-event` `Error` events
//!    - timeout / abort supervisor that delivers SIGTERM-then-SIGKILL.
//!
//! The function returns once the child is up and the supervisors are
//! attached. Callers stream events via the Tauri event bus and may call
//! [`ChildHandle::abort`] at any time.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{watch, Mutex};

use super::error::BridgeError;
use super::events::{
    classify_stderr_line, parse_jsonl_line, ErrorKind, TranscriptEvent, TranscriptEventPayload,
};
use super::process_group;

/// Tauri event name carrying every transcript event.
pub const TRANSCRIPT_EVENT_NAME: &str = "agent-transcript-event";

/// Tauri event name emitted exactly once when the child exits.
pub const SESSION_EXIT_EVENT_NAME: &str = "agent-session-exit";

/// Grace period between SIGTERM and SIGKILL during abort.
const ABORT_GRACE_PERIOD: Duration = Duration::from_secs(5);

/// Inputs for [`spawn_copilot`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotArgs {
    /// e.g. `mojito:second-brain`.
    pub agent: String,
    /// Model id (resolved from catalog or user free-text).
    pub model: String,
    /// Rendered prompt content (passed via `-p`).
    pub prompt: String,
    /// One or more `--add-dir` scoping paths. Always at least the managed
    /// clone and the session's staging dir; never `--allow-all-paths`.
    pub add_dirs: Vec<PathBuf>,
    /// `--share` audit markdown destination. Parent dir is created if
    /// missing.
    pub share_path: PathBuf,
    /// CogniStore-side session id (NOT Copilot's internal session). Used
    /// to tag emitted events.
    pub session_id: String,
    /// Logical phase: `intake`, `pr-cut`, `scaffold-project`, etc.
    pub phase: String,
    /// Hard timeout. On expiry the bridge sends SIGTERM, then SIGKILL.
    #[serde(default = "default_timeout")]
    pub timeout_secs: u64,
    /// Where to mirror stderr verbatim. Parent dir is created if missing.
    pub stderr_log_path: PathBuf,
    /// Working directory for the child (the managed clone path).
    pub cwd: PathBuf,
}

fn default_timeout() -> u64 {
    600
}

/// Handle returned to the caller (typically the Tauri command layer).
///
/// `abort()` is fire-and-forget; observers should listen for the
/// `agent-session-exit` Tauri event for the actual termination.
#[derive(Clone)]
pub struct ChildHandle {
    pub session_id: String,
    pub pid: u32,
    abort_tx: Arc<Mutex<Option<watch::Sender<bool>>>>,
}

impl ChildHandle {
    /// Request abort. Idempotent; safe to call multiple times. The
    /// supervisor task delivers SIGTERM, waits up to 5s, then SIGKILL.
    pub async fn abort(&self) {
        let mut guard = self.abort_tx.lock().await;
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(true);
        }
        // Drop the sender after one signal so subsequent calls are no-ops.
        guard.take();
    }
}

/// Payload emitted on the [`SESSION_EXIT_EVENT_NAME`] Tauri event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExitPayload {
    pub session_id: String,
    pub phase: String,
    pub exit_code: Option<i32>,
    /// True when the supervisor aborted the run (timeout or user abort).
    pub aborted: bool,
    /// True when the timeout fired (subset of `aborted`).
    pub timed_out: bool,
}

/// Spawn `copilot` and attach supervisors. Returns once the child is up.
pub async fn spawn_copilot(
    args: CopilotArgs,
    app: AppHandle,
) -> Result<ChildHandle, BridgeError> {
    // ---- validate paths ----------------------------------------------------
    if !args.cwd.is_dir() {
        return Err(BridgeError::InvalidPath(args.cwd.clone()));
    }
    for d in &args.add_dirs {
        if !d.is_dir() {
            return Err(BridgeError::InvalidPath(d.clone()));
        }
    }

    // Ensure parent dirs for share + stderr log exist.
    if let Some(parent) = args.share_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| BridgeError::Mkdir {
                path: parent.to_path_buf(),
                source: e,
            })?;
    }
    if let Some(parent) = args.stderr_log_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| BridgeError::Mkdir {
                path: parent.to_path_buf(),
                source: e,
            })?;
    }

    // ---- assemble argv -----------------------------------------------------
    // NOTE: per spec, every spawn unconditionally includes
    //   --output-format json --allow-all-tools --no-ask-user
    // and never --allow-all-paths / --yolo.
    let mut cmd = Command::new("copilot");
    cmd.arg("--output-format")
        .arg("json")
        .arg("--allow-all-tools")
        .arg("--no-ask-user")
        .arg("--agent")
        .arg(&args.agent)
        .arg("--model")
        .arg(&args.model)
        .arg("--share")
        .arg(&args.share_path);

    for d in &args.add_dirs {
        cmd.arg("--add-dir").arg(d);
    }

    cmd.arg("-p").arg(&args.prompt);

    cmd.current_dir(&args.cwd);
    cmd.env("COPILOT_ALLOW_ALL", "1");
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    process_group::configure_new_process_group(&mut cmd);

    // ---- spawn -------------------------------------------------------------
    let mut child = cmd.spawn().map_err(BridgeError::Spawn)?;
    let pid = child
        .id()
        .ok_or_else(|| BridgeError::Spawn(std::io::Error::other("child has no pid")))?;

    #[cfg(windows)]
    {
        // Best-effort job-object attach. Failure is logged but not fatal;
        // the per-pid CREATE_NEW_PROCESS_GROUP still allows targeted abort.
        let _ = process_group::assign_to_job(pid);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| BridgeError::Spawn(std::io::Error::other("no stdout pipe")))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| BridgeError::Spawn(std::io::Error::other("no stderr pipe")))?;

    let (abort_tx, abort_rx) = watch::channel(false);
    let abort_handle = Arc::new(Mutex::new(Some(abort_tx)));

    // ---- stdout reader -----------------------------------------------------
    {
        let app = app.clone();
        let session_id = args.session_id.clone();
        let phase = args.phase.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let event = parse_jsonl_line(&line);
                        emit_transcript(&app, &session_id, &phase, event);
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        });
    }

    // ---- stderr reader (file mirror + pattern classifier) ------------------
    {
        let app = app.clone();
        let session_id = args.session_id.clone();
        let phase = args.phase.clone();
        let log_path = args.stderr_log_path.clone();
        tokio::spawn(async move {
            let mut log_file = match tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)
                .await
            {
                Ok(f) => Some(f),
                Err(_) => None,
            };
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if let Some(file) = log_file.as_mut() {
                            let _ = file.write_all(line.as_bytes()).await;
                            let _ = file.write_all(b"\n").await;
                        }
                        if let Some(kind) = classify_stderr_line(&line) {
                            emit_transcript(
                                &app,
                                &session_id,
                                &phase,
                                TranscriptEvent::Error {
                                    kind,
                                    message: line,
                                },
                            );
                        }
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
            if let Some(mut file) = log_file {
                let _ = file.flush().await;
            }
        });
    }

    // ---- exit / abort / timeout supervisor ---------------------------------
    {
        let app = app.clone();
        let session_id = args.session_id.clone();
        let phase = args.phase.clone();
        let timeout = Duration::from_secs(args.timeout_secs.max(1));
        let mut abort_rx = abort_rx;
        tokio::spawn(async move {
            let mut aborted = false;
            let mut timed_out = false;

            // Wait for either child exit, abort signal, or timeout.
            let exit_status = tokio::select! {
                status = child.wait() => status.ok(),
                _ = wait_for_abort(&mut abort_rx) => {
                    aborted = true;
                    None
                }
                _ = tokio::time::sleep(timeout) => {
                    aborted = true;
                    timed_out = true;
                    None
                }
            };

            let exit_status = if let Some(s) = exit_status {
                Some(s)
            } else {
                // We were aborted or timed out: deliver SIGTERM, wait
                // up to 5s, then SIGKILL.
                process_group::terminate_group(pid);
                let killed = tokio::time::timeout(ABORT_GRACE_PERIOD, child.wait()).await;
                match killed {
                    Ok(Ok(s)) => Some(s),
                    _ => {
                        process_group::force_kill_group(pid);
                        child.wait().await.ok()
                    }
                }
            };

            let exit_code = exit_status.and_then(|s| s.code());
            let _ = app.emit(
                SESSION_EXIT_EVENT_NAME,
                SessionExitPayload {
                    session_id,
                    phase,
                    exit_code,
                    aborted,
                    timed_out,
                },
            );
        });
    }

    Ok(ChildHandle {
        session_id: args.session_id,
        pid,
        abort_tx: abort_handle,
    })
}

/// Block until the abort watch channel transitions to `true`.
async fn wait_for_abort(rx: &mut watch::Receiver<bool>) {
    loop {
        if *rx.borrow() {
            return;
        }
        if rx.changed().await.is_err() {
            // Sender dropped; treat as no-abort and just park forever.
            std::future::pending::<()>().await;
            return;
        }
    }
}

fn emit_transcript(app: &AppHandle, session_id: &str, phase: &str, event: TranscriptEvent) {
    let payload = TranscriptEventPayload {
        session_id: session_id.to_string(),
        phase: phase.to_string(),
        event,
    };
    let _ = app.emit(TRANSCRIPT_EVENT_NAME, payload);
}
