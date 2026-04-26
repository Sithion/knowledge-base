//! Tauri command surface for the freshness service.
//!
//! All three commands return a `Vec<FreshnessEvent>` so the JS side gets a
//! single round-trip with the full lifecycle (check → pull → import) when
//! it asks for the combined operation. Each event is also emitted on the
//! `sb-freshness-event` Tauri event so the dashboard can render progress.

use tauri::{AppHandle, Emitter, State};

use super::events::FreshnessEvent;
use super::service::{FreshnessStatus, SbFreshnessService};

/// Topic name used for `app.emit(...)`. The dashboard subscribes via
/// `listen('sb-freshness-event', ...)`.
pub const FRESHNESS_EVENT_TOPIC: &str = "sb-freshness-event";

fn emit_all(app: &AppHandle, events: &[FreshnessEvent]) {
    for ev in events {
        // best-effort — emit failure here is non-fatal for the command itself
        let _ = app.emit(FRESHNESS_EVENT_TOPIC, ev);
    }
}

/// Run the observational freshness check (no mutation). Returns the
/// emitted events for callers that prefer command-style results to
/// event subscription.
#[tauri::command]
pub async fn sb_freshness_check(
    app: AppHandle,
    service: State<'_, SbFreshnessService>,
) -> Result<Vec<FreshnessEvent>, String> {
    let events = service.check_freshness().await;
    emit_all(&app, &events);
    Ok(events)
}

/// Pull origin/<branch> with `--ff-only` and immediately invoke the SB
/// → CogniStore sync script. Combined for the dashboard's "Pull &
/// re-import" button.
#[tauri::command]
pub async fn sb_freshness_pull_and_import(
    app: AppHandle,
    service: State<'_, SbFreshnessService>,
) -> Result<Vec<FreshnessEvent>, String> {
    let mut events = service.pull_latest().await;
    // Only proceed to import if pull did not Failed-out. Failure variant is
    // always the last event in the vec when something went wrong.
    let pull_failed = matches!(events.last(), Some(FreshnessEvent::Failed { .. }));
    if !pull_failed {
        let imp = service.run_import_script().await;
        events.extend(imp);
    }
    emit_all(&app, &events);
    Ok(events)
}

/// Return the cached status. Cheap (no IO).
#[tauri::command]
pub async fn sb_freshness_status(
    service: State<'_, SbFreshnessService>,
) -> Result<FreshnessStatus, String> {
    Ok(service.snapshot().await)
}
