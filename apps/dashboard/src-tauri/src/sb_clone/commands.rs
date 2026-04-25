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
