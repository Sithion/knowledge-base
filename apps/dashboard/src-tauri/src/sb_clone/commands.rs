//! Tauri command surface for the managed-clone lifecycle.

use tauri::{AppHandle, Emitter, State};

use super::events::CloneEvent;
use super::manager::{CloneStatus, ManagedCloneManager};

pub const CLONE_EVENT_TOPIC: &str = "sb-clone-event";

/// Tauri-managed state alias to keep main.rs imports tidy.
pub type ManagedCloneState = ManagedCloneManager;

fn emit_all(app: &AppHandle, events: &[CloneEvent]) {
    for ev in events {
        let _ = app.emit(CLONE_EVENT_TOPIC, ev);
    }
}

/// Persist a remote URL to `~/.cognistore/sb-remote-url.txt`, swap it
/// into the running clone manager, and immediately attempt to ensure
/// the clone. Used by the first-run wizard so the user can paste a URL
/// and clone in one click without restarting.
#[tauri::command]
pub async fn sb_clone_save_remote_url(
    app: AppHandle,
    manager: State<'_, ManagedCloneManager>,
    url: String,
) -> Result<Vec<CloneEvent>, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("Remote URL is empty".into());
    }
    let home = dirs::home_dir().ok_or("Could not resolve home directory")?;
    let cfg_dir = home.join(".cognistore");
    tokio::fs::create_dir_all(&cfg_dir)
        .await
        .map_err(|e| format!("Failed to create config dir: {e}"))?;
    let cfg_file = cfg_dir.join("sb-remote-url.txt");
    tokio::fs::write(&cfg_file, &url)
        .await
        .map_err(|e| format!("Failed to write remote URL: {e}"))?;

    let mut current = manager.config_snapshot().await;
    current.remote_url = Some(url);
    manager.replace_config(current).await;

    let events = manager.ensure_clone().await;
    emit_all(&app, &events);
    Ok(events)
}

/// Bootstrap or validate the managed Second Brain clone.
#[tauri::command]
pub async fn sb_clone_ensure(
    app: AppHandle,
    manager: State<'_, ManagedCloneManager>,
) -> Result<Vec<CloneEvent>, String> {
    let events = manager.ensure_clone().await;
    emit_all(&app, &events);
    Ok(events)
}

/// Non-mutating clone status snapshot.
#[tauri::command]
pub async fn sb_clone_status(
    manager: State<'_, ManagedCloneManager>,
) -> Result<CloneStatus, String> {
    Ok(manager.get_clone_status().await)
}

/// Prune orphaned `intake/*` and `sb-intake/*` local branches whose
/// remote tracking branch is gone.
#[tauri::command]
pub async fn sb_clone_cleanup(
    app: AppHandle,
    manager: State<'_, ManagedCloneManager>,
) -> Result<Vec<CloneEvent>, String> {
    let events = manager.cleanup_orphan_branches().await;
    emit_all(&app, &events);
    Ok(events)
}
