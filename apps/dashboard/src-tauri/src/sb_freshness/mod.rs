//! Second Brain managed-clone freshness service.
//!
//! Implements section 2.5 of `openspec/changes/ai-stack-poc-cognistore/tasks.md`.
//!
//! Surfaces three operations to the Tauri frontend:
//!  - `sb_freshness_check`        — git fetch + count behind (no mutation).
//!  - `sb_freshness_pull_and_import` — fast-forward + run sync script.
//!  - `sb_freshness_status`       — return last cached state (no IO).
//!
//! All operations honor the `enableSbOrchestration` gate. When the gate is
//! false, every command returns a `Disabled { reason }` event without
//! touching the filesystem.
//!
//! Wave-3 scope: this service assumes the managed clone exists. Wave-5 will
//! own clone-on-first-use; until then we surface a clear `NotInitialized`
//! state so the UI can prompt.

pub mod commands;
pub mod events;
pub mod service;

pub use events::{FreshnessEvent, FreshnessFailureKind};
pub use service::{FreshnessConfig, FreshnessStatus, SbFreshnessService};
