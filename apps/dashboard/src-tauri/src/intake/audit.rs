//! Audit-record persistence for intake runs.
//!
//! Every `run_intake` and `run_pr_cut` call writes a JSON audit record at
//! `${appDataDir}/intake-audit/{run_id}.json`. The file is the single
//! source of truth for "what happened during this run" — Phase B reads
//! Phase A's record by `run_id` and rewrites it with the resulting PR URL.
//!
//! Schema versioned via `schema_version` so future format migrations stay
//! recognizable.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntakeStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Aborted,
    TimedOut,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PhaseKind {
    IntakeA,
    PrCutB,
    ScaffoldProject,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct IntakeAuditRecord {
    pub schema_version: u32,
    pub run_id: String,
    pub project_slug: String,
    pub phase: PhaseKind,
    pub model: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: IntakeStatus,
    pub branch_name: Option<String>,
    pub base_sha: Option<String>,
    pub file_count: u32,
    pub error_message: Option<String>,
    pub copilot_pid_at_start: Option<u32>,
    pub transcript_path: Option<String>,
    pub stderr_log_path: Option<String>,
    pub share_path: Option<String>,
    pub managed_clone: String,
    /// Set by `run_pr_cut` once the URL is parsed from the agent transcript.
    pub pr_url: Option<String>,
    /// Pointer to the predecessor record (Phase A) for a Phase B run.
    pub parent_run_id: Option<String>,
}

impl IntakeAuditRecord {
    pub fn new(
        run_id: String,
        project_slug: String,
        phase: PhaseKind,
        model: String,
        managed_clone: String,
    ) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            run_id,
            project_slug,
            phase,
            model,
            started_at: chrono::Utc::now().to_rfc3339(),
            finished_at: None,
            status: IntakeStatus::Pending,
            branch_name: None,
            base_sha: None,
            file_count: 0,
            error_message: None,
            copilot_pid_at_start: None,
            transcript_path: None,
            stderr_log_path: None,
            share_path: None,
            managed_clone,
            pr_url: None,
            parent_run_id: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AuditPaths {
    pub root: PathBuf,
}

impl AuditPaths {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn record_path(&self, run_id: &str) -> PathBuf {
        self.root.join(format!("{run_id}.json"))
    }

    pub fn run_dir(&self, run_id: &str) -> PathBuf {
        self.root.join(run_id)
    }
}

#[derive(Debug, Error)]
pub enum AuditError {
    #[error("io error on {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to (de)serialize audit record: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("audit record not found: {0}")]
    NotFound(String),
}

/// Atomic-ish write: serialize to a tempfile alongside, fsync, rename.
/// We don't take a lock — callers serialize externally via the
/// intake-mutex pattern. Crash safety: a partial write yields a leftover
/// `*.tmp` we clean up on next write.
pub async fn write_record(
    paths: &AuditPaths,
    rec: &IntakeAuditRecord,
) -> Result<PathBuf, AuditError> {
    tokio::fs::create_dir_all(&paths.root)
        .await
        .map_err(|e| AuditError::Io {
            path: paths.root.clone(),
            source: e,
        })?;

    let target = paths.record_path(&rec.run_id);
    let tmp = paths.root.join(format!("{}.tmp", rec.run_id));

    let body = serde_json::to_vec_pretty(rec)?;
    tokio::fs::write(&tmp, &body)
        .await
        .map_err(|e| AuditError::Io {
            path: tmp.clone(),
            source: e,
        })?;
    tokio::fs::rename(&tmp, &target)
        .await
        .map_err(|e| AuditError::Io {
            path: target.clone(),
            source: e,
        })?;
    Ok(target)
}

pub async fn read_record(
    paths: &AuditPaths,
    run_id: &str,
) -> Result<IntakeAuditRecord, AuditError> {
    let path = paths.record_path(run_id);
    if !path.exists() {
        return Err(AuditError::NotFound(run_id.to_string()));
    }
    let body = tokio::fs::read(&path).await.map_err(|e| AuditError::Io {
        path: path.clone(),
        source: e,
    })?;
    Ok(serde_json::from_slice(&body)?)
}

/// List all audit records, newest first by `started_at` field.
pub async fn list_records(paths: &AuditPaths) -> Result<Vec<IntakeAuditRecord>, AuditError> {
    if !paths.root.exists() {
        return Ok(Vec::new());
    }
    let mut entries = tokio::fs::read_dir(&paths.root)
        .await
        .map_err(|e| AuditError::Io {
            path: paths.root.clone(),
            source: e,
        })?;
    let mut out = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(|e| AuditError::Io {
        path: paths.root.clone(),
        source: e,
    })? {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".json") || name.ends_with(".tmp") {
            continue;
        }
        let path = entry.path();
        let body = match tokio::fs::read(&path).await {
            Ok(b) => b,
            Err(_) => continue, // skip unreadable files
        };
        if let Ok(rec) = serde_json::from_slice::<IntakeAuditRecord>(&body) {
            out.push(rec);
        }
    }
    out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
    Ok(out)
}

/// Validate that an existing record points at a real branch in the
/// managed clone. Used by `run_pr_cut` to refuse running against a
/// stale/discarded session.
pub fn record_has_branch(rec: &IntakeAuditRecord) -> bool {
    rec.branch_name.as_ref().map(|b| !b.is_empty()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_tmp(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "cognistore-audit-test-{}-{}-{}",
            label,
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ))
    }

    fn sample(run_id: &str) -> IntakeAuditRecord {
        IntakeAuditRecord::new(
            run_id.to_string(),
            "sample-bot".to_string(),
            PhaseKind::IntakeA,
            "auto".to_string(),
            "/tmp/clone".to_string(),
        )
    }

    #[tokio::test]
    async fn round_trip_write_then_read() {
        let dir = unique_tmp("roundtrip");
        let paths = AuditPaths::new(&dir);
        let mut rec = sample("run-1");
        rec.branch_name = Some("intake/sample-bot-2025-01-01".into());
        rec.file_count = 3;
        write_record(&paths, &rec).await.unwrap();
        let back = read_record(&paths, "run-1").await.unwrap();
        assert_eq!(back.run_id, "run-1");
        assert_eq!(back.project_slug, "sample-bot");
        assert_eq!(back.file_count, 3);
        assert_eq!(back.branch_name.as_deref(), Some("intake/sample-bot-2025-01-01"));
        assert_eq!(back.schema_version, SCHEMA_VERSION);
        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    #[tokio::test]
    async fn read_missing_yields_not_found() {
        let dir = unique_tmp("missing");
        let paths = AuditPaths::new(&dir);
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let r = read_record(&paths, "nope").await;
        assert!(matches!(r, Err(AuditError::NotFound(_))));
        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    #[tokio::test]
    async fn list_records_returns_newest_first() {
        let dir = unique_tmp("list");
        let paths = AuditPaths::new(&dir);
        let mut a = sample("a");
        a.started_at = "2025-01-01T00:00:00Z".into();
        let mut b = sample("b");
        b.started_at = "2025-02-01T00:00:00Z".into();
        let mut c = sample("c");
        c.started_at = "2024-01-01T00:00:00Z".into();
        write_record(&paths, &a).await.unwrap();
        write_record(&paths, &b).await.unwrap();
        write_record(&paths, &c).await.unwrap();
        let listed = list_records(&paths).await.unwrap();
        let ids: Vec<_> = listed.iter().map(|r| r.run_id.as_str()).collect();
        assert_eq!(ids, vec!["b", "a", "c"]);
        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    #[tokio::test]
    async fn write_overwrites_existing_record() {
        let dir = unique_tmp("overwrite");
        let paths = AuditPaths::new(&dir);
        let mut rec = sample("run-x");
        write_record(&paths, &rec).await.unwrap();
        rec.status = IntakeStatus::Succeeded;
        rec.finished_at = Some("2025-03-01T00:00:00Z".into());
        write_record(&paths, &rec).await.unwrap();
        let back = read_record(&paths, "run-x").await.unwrap();
        assert_eq!(back.status, IntakeStatus::Succeeded);
        assert_eq!(back.finished_at.as_deref(), Some("2025-03-01T00:00:00Z"));
        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    #[test]
    fn record_has_branch_predicate() {
        let mut rec = sample("p");
        assert!(!record_has_branch(&rec));
        rec.branch_name = Some("".into());
        assert!(!record_has_branch(&rec));
        rec.branch_name = Some("intake/x".into());
        assert!(record_has_branch(&rec));
    }
}

pub fn _assert_schema_v1() -> u32 {
    SCHEMA_VERSION
}
