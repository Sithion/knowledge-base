//! Tauri command surface for the intake pipeline.

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, State};
use tokio::process::Command;

use super::audit::IntakeAuditRecord;
use super::first_run::{run_first_run_setup, FirstRunReport};
use super::runner::{IntakeResult, IntakeRunArgs, IntakeService, PrCutResult, PrCutRunArgs};

/// Tauri-managed state alias.
pub type IntakeServiceState = IntakeService;

#[tauri::command]
pub async fn run_intake(
    args: IntakeRunArgs,
    app: AppHandle,
    service: State<'_, IntakeService>,
) -> Result<IntakeResult, String> {
    service.run_intake(args, app).await
}

#[tauri::command]
pub async fn run_pr_cut(
    args: PrCutRunArgs,
    app: AppHandle,
    service: State<'_, IntakeService>,
) -> Result<PrCutResult, String> {
    service.run_pr_cut(args, app).await
}

#[tauri::command]
pub async fn intake_first_run_setup(
    service: State<'_, IntakeService>,
) -> Result<FirstRunReport, String> {
    Ok(run_first_run_setup(service.clone_manager()).await)
}

#[tauri::command]
pub async fn intake_list_audit_records(
    service: State<'_, IntakeService>,
) -> Result<Vec<IntakeAuditRecord>, String> {
    service.list_audit_records().await
}

#[tauri::command]
pub async fn intake_get_audit_record(
    run_id: String,
    service: State<'_, IntakeService>,
) -> Result<IntakeAuditRecord, String> {
    service.get_audit_record(&run_id).await
}

/// Lock-state probe for the Health pane. Non-mutating: peeks at the
/// `${managedClone}/.cognistore-intake.lock` file by attempting an
/// exclusive lock and immediately releasing it. If the lock is held by
/// any process (this one included), returns `held: true`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakeLockState {
    pub managed_clone_path: String,
    pub lock_file_exists: bool,
    pub held: bool,
}

#[tauri::command]
pub async fn intake_lock_state(
    service: State<'_, IntakeService>,
) -> Result<IntakeLockState, String> {
    let cfg = service.config_snapshot().await;
    let lock_path = cfg.managed_clone_path.join(".cognistore-intake.lock");
    let exists = lock_path.exists();
    // Best-effort probe: try to acquire and release immediately. If the
    // managed clone dir doesn't exist, treat as not-held.
    let held = if !cfg.managed_clone_path.is_dir() {
        false
    } else {
        match super::lock::IntakeLock::acquire(&cfg.managed_clone_path) {
            Ok(_lock) => false, // lock dropped immediately
            Err(super::lock::LockError::Busy) => true,
            Err(_) => false,
        }
    };
    Ok(IntakeLockState {
        managed_clone_path: cfg.managed_clone_path.display().to_string(),
        lock_file_exists: exists,
        held,
    })
}

/// Compute `git diff <baseSha>..HEAD` for the intake branch associated
/// with `run_id`. Reads the audit record to resolve the base SHA, then
/// shells to `git` inside the managed clone.
///
/// Output is the raw unified diff (UTF-8, lossy). Returns an error if the
/// audit record is missing or doesn't have a base SHA recorded yet.
#[tauri::command]
pub async fn git_diff_intake_branch(
    run_id: String,
    service: State<'_, IntakeService>,
) -> Result<String, String> {
    let cfg = service.config_snapshot().await;
    let record = service.get_audit_record(&run_id).await?;
    let base_sha = record
        .base_sha
        .clone()
        .ok_or_else(|| format!("audit record {run_id} has no baseSha yet"))?;
    let managed_clone: &Path = &cfg.managed_clone_path;
    if !managed_clone.is_dir() {
        return Err(format!(
            "managed clone path does not exist: {}",
            managed_clone.display()
        ));
    }
    let out = Command::new("git")
        .arg("-C")
        .arg(managed_clone)
        .arg("diff")
        .arg("--no-color")
        .arg(format!("{base_sha}..HEAD"))
        .output()
        .await
        .map_err(|e| format!("git diff failed to spawn: {e}"))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        return Err(format!(
            "git diff exited with {:?}: {}",
            out.status.code(),
            stderr.trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Cancel an in-flight intake/PR-cut run by aborting the underlying
/// Copilot CLI session. Thin convenience wrapper that defers to the
/// copilot-bridge registry; sessions are typically named `intake:<run_id>`
/// or `pr-cut:<run_id>` (see `runner.rs`).
#[tauri::command]
pub async fn cancel_intake_run(
    session_id: String,
    registry: State<'_, crate::copilot_bridge::registry::CopilotRegistry>,
) -> Result<(), String> {
    let handle = registry
        .remove(&session_id)
        .await
        .ok_or_else(|| format!("session {session_id} not found"))?;
    handle.abort().await;
    Ok(())
}

/// Bootstrap or re-bootstrap the Context Engine for a repository by
/// shelling to `templates/context-engine/scripts/bootstrap_real_repo.sh`
/// (idempotent). Returns the script's combined stdout+stderr tail.
#[tauri::command]
pub async fn context_engine_reindex(repo_path: String) -> Result<String, String> {
    let path = Path::new(&repo_path);
    if !path.is_dir() {
        return Err(format!("repo path does not exist: {repo_path}"));
    }
    // Prefer in-tree build_index.py if the repo already has the scaffold;
    // fall back to bootstrap script.
    let build_index = path.join(".ai/index/build_index.py");
    let venv_python = path.join(".venv-context/bin/python");
    let (program, args): (String, Vec<String>) = if build_index.exists() {
        if venv_python.exists() {
            (
                venv_python.display().to_string(),
                vec![build_index.display().to_string()],
            )
        } else {
            (
                "python3".to_string(),
                vec![build_index.display().to_string()],
            )
        }
    } else {
        return Err(format!(
            "no .ai/index/build_index.py at {repo_path} — run stack.init first"
        ));
    };
    let out = Command::new(&program)
        .args(&args)
        .current_dir(path)
        .output()
        .await
        .map_err(|e| format!("spawn failed: {e}"))?;
    let mut combined = String::from_utf8_lossy(&out.stdout).into_owned();
    combined.push_str(&String::from_utf8_lossy(&out.stderr));
    if !out.status.success() {
        return Err(format!(
            "build_index exited with {:?}\n{}",
            out.status.code(),
            tail(&combined, 4096)
        ));
    }
    Ok(tail(&combined, 4096))
}

/// Read the last-build timestamp for a Context Engine repo from
/// `.ai/index/.last-build` (mtime in millis since epoch). Returns `None`
/// if the file doesn't exist yet.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextEngineRepoStatus {
    pub repo_path: String,
    pub has_scaffold: bool,
    pub last_build_at: Option<String>,
    pub decisions_count: u32,
}

#[tauri::command]
pub async fn context_engine_repo_status(
    repo_path: String,
) -> Result<ContextEngineRepoStatus, String> {
    let path = Path::new(&repo_path);
    let scaffold = path.join(".ai/index");
    let has_scaffold = scaffold.is_dir();
    let last_build_at = if has_scaffold {
        let last_build_file = path.join(".ai/index/.last-build");
        match tokio::fs::metadata(&last_build_file).await {
            Ok(meta) => meta.modified().ok().and_then(|t| {
                let ts: chrono::DateTime<chrono::Utc> = t.into();
                Some(ts.to_rfc3339())
            }),
            Err(_) => None,
        }
    } else {
        None
    };
    let decisions_count = if has_scaffold {
        let log = path.join(".ai/memory/decisions.log");
        match tokio::fs::read_to_string(&log).await {
            Ok(s) => s.lines().filter(|l| !l.trim().is_empty()).count() as u32,
            Err(_) => 0,
        }
    } else {
        0
    };
    Ok(ContextEngineRepoStatus {
        repo_path: repo_path.clone(),
        has_scaffold,
        last_build_at,
        decisions_count,
    })
}

fn tail(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let start = s.len() - max_bytes;
    // align to char boundary
    let mut i = start;
    while !s.is_char_boundary(i) && i < s.len() {
        i += 1;
    }
    format!("…\n{}", &s[i..])
}
