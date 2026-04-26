//! Intake pipeline orchestration: Phase A (intake), Phase B (PR cut),
//! audit logging, single-instance lock, and first-run setup.
//!
//! Submodules:
//!  - [`lock`]      — OS-level `flock` on `${managedClone}/.cognistore-intake.lock`.
//!  - [`audit`]     — JSON audit records for every run (read+write helpers).
//!  - [`runner`]    — Phase A + Phase B orchestration on top of W4's
//!                    `copilot_bridge`.
//!  - [`first_run`] — environment detection (managed clone, copilot CLI presence,
//!                    copilot auth) for the first-run setup screen.
//!  - [`commands`]  — Tauri command surface (`run_intake`, `run_pr_cut`,
//!                    `intake_first_run_setup`, audit reads).

pub mod audit;
pub mod commands;
pub mod first_run;
pub mod lock;
pub mod runner;

pub use audit::{AuditPaths, IntakeAuditRecord};
pub use commands::{
    cancel_intake_run, context_engine_reindex, context_engine_repo_status,
    git_diff_intake_branch, intake_first_run_setup, intake_get_audit_record, intake_list_audit_records,
    intake_lock_state, run_intake, run_pr_cut, IntakeServiceState,
};
pub use first_run::{FirstRunReport, FirstRunStep};
pub use lock::{IntakeLock, LockError};
pub use runner::{IntakePipelineConfig, IntakeResult, IntakeService, PrCutResult};
