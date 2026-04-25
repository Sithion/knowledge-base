//! Tauri command surface for the intake pipeline.

use tauri::{AppHandle, State};

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
