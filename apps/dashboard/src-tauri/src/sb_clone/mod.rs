//! Managed Second Brain clone lifecycle.
//!
//! Owns `${aiStack.intakePipeline.workspaceDir}` (default
//! `${appDataDir}/second-brain-workspace/`). This is **distinct** from the
//! user's personal `secondBrainPath` checkout — Wave-3's freshness service
//! observes the latter; the intake pipeline owns the former.
//!
//! Surfaces:
//!  - `ensure_clone(...)`       — clone-on-first-use, validate-on-subsequent
//!  - `get_clone_status(...)`   — non-mutating snapshot
//!  - `cleanup_orphan_branches` — prune `intake/*` (and `sb-intake/*`) locals
//!                                whose remote tracking branch is gone
//!
//! All operations honour the `enable_sb_orchestration` gate. With the gate
//! off, `ensure_clone` short-circuits with a structured `Disabled` error so
//! the UI can prompt the user to opt in.

pub mod commands;
pub mod events;
pub mod manager;

pub use commands::{
    sb_clone_cleanup, sb_clone_ensure, sb_clone_status, ManagedCloneState,
};
pub use events::{CloneEvent, CloneFailureKind};
pub use manager::{CloneConfig, CloneStatus, ManagedCloneManager};
