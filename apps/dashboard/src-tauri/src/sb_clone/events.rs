//! Event types emitted from the managed-clone lifecycle to the Tauri
//! frontend. Mirrors the shape of `sb_freshness::events::FreshnessEvent`
//! so the UI can render lifecycle progress with familiar primitives.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloneFailureKind {
    /// `enableSbOrchestration` is `false`.
    Disabled,
    /// `secondBrainRemote` is unset and we'd need to clone.
    NotConfigured,
    /// Workspace dir exists but is not a git repository.
    Corrupted,
    /// `git clone`, `git fetch`, `git rev-parse`, etc. failed.
    GitFailure,
    /// Filesystem failure (mkdir, etc.).
    Io,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CloneEvent {
    EnsureStarted {
        ts: String,
        workspace_dir: String,
    },
    Cloning {
        ts: String,
        remote_url: String,
        workspace_dir: String,
    },
    Validated {
        ts: String,
        workspace_dir: String,
        current_branch: Option<String>,
        remote_url: Option<String>,
    },
    EnsureComplete {
        ts: String,
        workspace_dir: String,
        already_existed: bool,
    },
    CleanupStarted {
        ts: String,
    },
    BranchPruned {
        ts: String,
        branch: String,
    },
    CleanupComplete {
        ts: String,
        pruned: u32,
    },
    Failed {
        ts: String,
        kind: CloneFailureKind,
        message: String,
    },
}

pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

impl CloneEvent {
    pub fn failed(kind: CloneFailureKind, message: impl Into<String>) -> Self {
        Self::Failed {
            ts: now_iso(),
            kind,
            message: message.into(),
        }
    }
}
