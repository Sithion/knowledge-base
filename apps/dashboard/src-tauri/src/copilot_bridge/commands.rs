//! Tauri command surface for the Copilot CLI bridge.

use tauri::{AppHandle, State};

use super::models::{list_models, ModelInfo};
use super::registry::CopilotRegistry;
use super::spawn::{spawn_copilot, CopilotArgs};

/// Returns the curated model catalog for dropdown population.
#[tauri::command]
pub fn get_copilot_models() -> Vec<ModelInfo> {
    list_models()
}

/// Spawn a Copilot CLI session. Returns the session id once the child is
/// up; subsequent transcript events arrive via the `agent-transcript-event`
/// Tauri event and the `agent-session-exit` event signals termination.
#[tauri::command]
pub async fn spawn_copilot_session(
    args: CopilotArgs,
    app: AppHandle,
    registry: State<'_, CopilotRegistry>,
) -> Result<String, String> {
    let session_id = args.session_id.clone();
    let handle = spawn_copilot(args, app).await.map_err(|e| e.to_string())?;
    registry.insert(handle).await;
    Ok(session_id)
}

/// Abort an in-flight session. SIGTERM, then SIGKILL after 5s.
#[tauri::command]
pub async fn abort_copilot_session(
    session_id: String,
    registry: State<'_, CopilotRegistry>,
) -> Result<(), String> {
    let handle = registry
        .remove(&session_id)
        .await
        .ok_or_else(|| format!("session {session_id} not found"))?;
    handle.abort().await;
    Ok(())
}
