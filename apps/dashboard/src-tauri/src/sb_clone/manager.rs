//! Managed-clone state machine. Owns the actual `git` IO.
//!
//! Holds a single in-process mutex over its `git` operations (matches the
//! pattern in `sb_freshness::service`) so concurrent UI clicks don't race
//! on the same clone. The OS-level `flock` for cross-process exclusion
//! lives in `intake::lock` and is acquired by the higher-level intake
//! flow before any mutation; clone bootstrap and status reads are
//! intentionally not gated by the file lock so the UI can surface clone
//! state even while another instance holds the intake lock.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::sync::Mutex;

use super::events::{now_iso, CloneEvent, CloneFailureKind};

/// Configuration snapshot. Captured at construction time; the dashboard
/// rebuilds the manager when config changes (matches sb_freshness).
#[derive(Debug, Clone)]
pub struct CloneConfig {
    /// Master gate — when false, every operation no-ops with a Disabled event.
    pub enable_sb_orchestration: bool,
    /// Where the managed clone lives. Required to do anything.
    pub workspace_dir: PathBuf,
    /// `git clone <remote> <workspace>` source. Required when the
    /// workspace doesn't yet exist; ignored when validating an existing one.
    pub remote_url: Option<String>,
    /// Default tracking branch — POC default `develop`.
    pub default_branch: String,
}

impl Default for CloneConfig {
    fn default() -> Self {
        Self {
            enable_sb_orchestration: false,
            workspace_dir: PathBuf::new(),
            remote_url: None,
            default_branch: "develop".to_string(),
        }
    }
}

/// Read-only snapshot returned by `get_clone_status`. Cheap (one-shot
/// `git` invocations under a mutex). UI uses this to decide whether to
/// surface the "Clone now" affordance.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CloneStatus {
    pub path: String,
    pub exists: bool,
    pub is_git_repo: bool,
    pub current_branch: Option<String>,
    pub remote_url: Option<String>,
    /// True iff the workspace dir exists, has a `.git/`, and `git status`
    /// reports a clean working tree.
    pub clean: bool,
}

/// Tauri-managed state. Cheap to clone (Arc).
#[derive(Clone)]
pub struct ManagedCloneManager {
    inner: Arc<Inner>,
}

struct Inner {
    config: Mutex<CloneConfig>,
    op_lock: Mutex<()>,
}

impl ManagedCloneManager {
    pub fn new(config: CloneConfig) -> Self {
        Self {
            inner: Arc::new(Inner {
                config: Mutex::new(config),
                op_lock: Mutex::new(()),
            }),
        }
    }

    pub async fn replace_config(&self, config: CloneConfig) {
        let mut g = self.inner.config.lock().await;
        *g = config;
    }

    pub async fn config_snapshot(&self) -> CloneConfig {
        self.inner.config.lock().await.clone()
    }

    /// Bootstrap or validate the managed clone. Returns the absolute path
    /// to the clone on success, or a list of events ending in `Failed`.
    ///
    /// Behaviour by state:
    ///   - workspace dir missing + remote configured → `git clone <remote>`
    ///   - workspace dir missing + no remote        → NotConfigured
    ///   - workspace dir exists + valid git repo    → ok (no fetch here)
    ///   - workspace dir exists + not git           → Corrupted
    pub async fn ensure_clone(&self) -> Vec<CloneEvent> {
        let _guard = self.inner.op_lock.lock().await;
        let mut events = Vec::with_capacity(3);
        let cfg = self.inner.config.lock().await.clone();

        if !cfg.enable_sb_orchestration {
            let ev = CloneEvent::failed(
                CloneFailureKind::Disabled,
                "enableSbOrchestration is false",
            );
            events.push(ev);
            return events;
        }

        if cfg.workspace_dir.as_os_str().is_empty() {
            events.push(CloneEvent::failed(
                CloneFailureKind::NotConfigured,
                "intakePipeline.workspaceDir is not configured",
            ));
            return events;
        }

        events.push(CloneEvent::EnsureStarted {
            ts: now_iso(),
            workspace_dir: cfg.workspace_dir.display().to_string(),
        });

        let exists = cfg.workspace_dir.exists();
        if exists {
            // Validate it's a git repo
            if !cfg.workspace_dir.join(".git").exists() {
                events.push(CloneEvent::failed(
                    CloneFailureKind::Corrupted,
                    format!(
                        "workspace exists but is not a git repository: {}",
                        cfg.workspace_dir.display()
                    ),
                ));
                return events;
            }

            // Capture branch + remote for the Validated event
            let branch = git_capture(&cfg.workspace_dir, &["rev-parse", "--abbrev-ref", "HEAD"])
                .await
                .ok()
                .map(|s| s.trim().to_string());
            let remote = git_capture(&cfg.workspace_dir, &["config", "--get", "remote.origin.url"])
                .await
                .ok()
                .map(|s| s.trim().to_string());
            events.push(CloneEvent::Validated {
                ts: now_iso(),
                workspace_dir: cfg.workspace_dir.display().to_string(),
                current_branch: branch,
                remote_url: remote,
            });
            events.push(CloneEvent::EnsureComplete {
                ts: now_iso(),
                workspace_dir: cfg.workspace_dir.display().to_string(),
                already_existed: true,
            });
            return events;
        }

        // Clone fresh
        let Some(remote_url) = cfg.remote_url.clone() else {
            events.push(CloneEvent::failed(
                CloneFailureKind::NotConfigured,
                "aiStack.secondBrainRemote is not configured",
            ));
            return events;
        };

        if let Some(parent) = cfg.workspace_dir.parent() {
            if let Err(e) = tokio::fs::create_dir_all(parent).await {
                events.push(CloneEvent::failed(
                    CloneFailureKind::Io,
                    format!("failed to create parent dir: {}", e),
                ));
                return events;
            }
        }

        events.push(CloneEvent::Cloning {
            ts: now_iso(),
            remote_url: remote_url.clone(),
            workspace_dir: cfg.workspace_dir.display().to_string(),
        });

        // Plain `git clone` so first-run does not require `gh auth` (gh is
        // only needed at PR-cut time).
        let parent = cfg
            .workspace_dir
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

        let leaf = cfg
            .workspace_dir
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("second-brain-workspace");

        let res = Command::new("git")
            .args([
                "clone",
                "--branch",
                &cfg.default_branch,
                "--single-branch",
                "--no-tags",
                &remote_url,
                leaf,
            ])
            .current_dir(&parent)
            .output()
            .await;

        match res {
            Ok(out) if out.status.success() => {
                events.push(CloneEvent::EnsureComplete {
                    ts: now_iso(),
                    workspace_dir: cfg.workspace_dir.display().to_string(),
                    already_existed: false,
                });
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
                events.push(CloneEvent::failed(
                    CloneFailureKind::GitFailure,
                    format!("git clone failed: {}", stderr.trim()),
                ));
            }
            Err(e) => {
                events.push(CloneEvent::failed(
                    CloneFailureKind::GitFailure,
                    format!("failed to invoke git: {}", e),
                ));
            }
        }

        events
    }

    /// Non-mutating snapshot.
    pub async fn get_clone_status(&self) -> CloneStatus {
        let cfg = self.inner.config.lock().await.clone();
        let path_str = cfg.workspace_dir.display().to_string();
        let exists = !cfg.workspace_dir.as_os_str().is_empty() && cfg.workspace_dir.exists();
        if !exists {
            return CloneStatus {
                path: path_str,
                exists: false,
                is_git_repo: false,
                current_branch: None,
                remote_url: None,
                clean: false,
            };
        }
        let is_git_repo = cfg.workspace_dir.join(".git").exists();
        if !is_git_repo {
            return CloneStatus {
                path: path_str,
                exists: true,
                is_git_repo: false,
                current_branch: None,
                remote_url: None,
                clean: false,
            };
        }

        let branch = git_capture(&cfg.workspace_dir, &["rev-parse", "--abbrev-ref", "HEAD"])
            .await
            .ok()
            .map(|s| s.trim().to_string());
        let remote = git_capture(&cfg.workspace_dir, &["config", "--get", "remote.origin.url"])
            .await
            .ok()
            .map(|s| s.trim().to_string());
        let clean = git_capture(&cfg.workspace_dir, &["status", "--porcelain"])
            .await
            .map(|s| s.trim().is_empty())
            .unwrap_or(false);

        CloneStatus {
            path: path_str,
            exists: true,
            is_git_repo: true,
            current_branch: branch,
            remote_url: remote,
            clean,
        }
    }

    /// Prune local branches matching `intake/*` or `sb-intake/*` whose
    /// upstream remote tracking branch no longer exists. Skips a branch
    /// if it is the current HEAD.
    pub async fn cleanup_orphan_branches(&self) -> Vec<CloneEvent> {
        let _guard = self.inner.op_lock.lock().await;
        let mut events = vec![CloneEvent::CleanupStarted { ts: now_iso() }];
        let cfg = self.inner.config.lock().await.clone();

        if !cfg.enable_sb_orchestration {
            events.push(CloneEvent::failed(
                CloneFailureKind::Disabled,
                "enableSbOrchestration is false",
            ));
            return events;
        }
        if !cfg.workspace_dir.exists() || !cfg.workspace_dir.join(".git").exists() {
            events.push(CloneEvent::failed(
                CloneFailureKind::Corrupted,
                "managed clone is not initialized",
            ));
            return events;
        }

        // Best-effort prune of stale remote refs first so the for-each-ref
        // gone-tracking detection actually has data to work from.
        let _ = Command::new("git")
            .args(["remote", "prune", "origin"])
            .current_dir(&cfg.workspace_dir)
            .output()
            .await;

        // List local branches with upstream-track gone.
        // Format: `refname:short upstream:track`
        // `[gone]` appears for branches whose upstream is removed.
        let listing = match git_capture(
            &cfg.workspace_dir,
            &[
                "for-each-ref",
                "--format=%(refname:short) %(upstream:track)",
                "refs/heads/",
            ],
        )
        .await
        {
            Ok(s) => s,
            Err(e) => {
                events.push(CloneEvent::failed(CloneFailureKind::GitFailure, e));
                return events;
            }
        };

        let current = git_capture(&cfg.workspace_dir, &["rev-parse", "--abbrev-ref", "HEAD"])
            .await
            .ok()
            .map(|s| s.trim().to_string());

        let mut pruned: u32 = 0;
        for line in listing.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let mut parts = line.splitn(2, ' ');
            let name = parts.next().unwrap_or("").trim();
            let track = parts.next().unwrap_or("").trim();
            if !is_intake_branch(name) {
                continue;
            }
            if !track.contains("[gone]") {
                continue;
            }
            if current.as_deref() == Some(name) {
                continue;
            }
            match Command::new("git")
                .args(["branch", "-D", name])
                .current_dir(&cfg.workspace_dir)
                .output()
                .await
            {
                Ok(out) if out.status.success() => {
                    pruned += 1;
                    events.push(CloneEvent::BranchPruned {
                        ts: now_iso(),
                        branch: name.to_string(),
                    });
                }
                _ => { /* skip silently — best-effort */ }
            }
        }

        events.push(CloneEvent::CleanupComplete {
            ts: now_iso(),
            pruned,
        });
        events
    }
}

fn is_intake_branch(name: &str) -> bool {
    name.starts_with("intake/") || name.starts_with("sb-intake/")
}

async fn git_capture(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| format!("failed to invoke git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_tmp(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "cognistore-clone-test-{}-{}-{}",
            label,
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ))
    }

    #[tokio::test]
    async fn ensure_clone_disabled_yields_disabled_event() {
        let m = ManagedCloneManager::new(CloneConfig {
            enable_sb_orchestration: false,
            workspace_dir: unique_tmp("disabled"),
            remote_url: Some("https://example.invalid/repo.git".to_string()),
            default_branch: "develop".to_string(),
        });
        let events = m.ensure_clone().await;
        match events.last().unwrap() {
            CloneEvent::Failed { kind, .. } => {
                assert_eq!(*kind, CloneFailureKind::Disabled)
            }
            other => panic!("expected Failed(Disabled), got {:?}", other),
        }
    }

    #[tokio::test]
    async fn ensure_clone_missing_remote_yields_not_configured() {
        let m = ManagedCloneManager::new(CloneConfig {
            enable_sb_orchestration: true,
            workspace_dir: unique_tmp("missing-remote"),
            remote_url: None,
            default_branch: "develop".to_string(),
        });
        let events = m.ensure_clone().await;
        match events.last().unwrap() {
            CloneEvent::Failed { kind, .. } => {
                assert_eq!(*kind, CloneFailureKind::NotConfigured)
            }
            other => panic!("expected Failed(NotConfigured), got {:?}", other),
        }
    }

    #[tokio::test]
    async fn ensure_clone_existing_non_git_dir_yields_corrupted() {
        let dir = unique_tmp("corrupted");
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let m = ManagedCloneManager::new(CloneConfig {
            enable_sb_orchestration: true,
            workspace_dir: dir.clone(),
            remote_url: Some("ignored".to_string()),
            default_branch: "develop".to_string(),
        });
        let events = m.ensure_clone().await;
        match events.last().unwrap() {
            CloneEvent::Failed { kind, .. } => {
                assert_eq!(*kind, CloneFailureKind::Corrupted)
            }
            other => panic!("expected Failed(Corrupted), got {:?}", other),
        }
        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    #[tokio::test]
    async fn ensure_clone_existing_git_dir_yields_complete() {
        let dir = unique_tmp("valid-git");
        tokio::fs::create_dir_all(&dir.join(".git")).await.unwrap();
        let m = ManagedCloneManager::new(CloneConfig {
            enable_sb_orchestration: true,
            workspace_dir: dir.clone(),
            remote_url: None,
            default_branch: "develop".to_string(),
        });
        let events = m.ensure_clone().await;
        let last = events.last().unwrap();
        match last {
            CloneEvent::EnsureComplete {
                already_existed, ..
            } => {
                assert!(*already_existed);
            }
            other => panic!("expected EnsureComplete{{already_existed:true}}, got {:?}", other),
        }
        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    #[tokio::test]
    async fn status_for_missing_path_reports_not_exists() {
        let m = ManagedCloneManager::new(CloneConfig {
            enable_sb_orchestration: true,
            workspace_dir: unique_tmp("missing-status"),
            remote_url: None,
            default_branch: "develop".to_string(),
        });
        let s = m.get_clone_status().await;
        assert!(!s.exists);
        assert!(!s.is_git_repo);
        assert!(s.current_branch.is_none());
        assert!(!s.clean);
    }

    #[tokio::test]
    async fn status_for_non_git_dir_reports_exists_but_not_repo() {
        let dir = unique_tmp("status-non-git");
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let m = ManagedCloneManager::new(CloneConfig {
            enable_sb_orchestration: true,
            workspace_dir: dir.clone(),
            remote_url: None,
            default_branch: "develop".to_string(),
        });
        let s = m.get_clone_status().await;
        assert!(s.exists);
        assert!(!s.is_git_repo);
        tokio::fs::remove_dir_all(&dir).await.ok();
    }

    #[test]
    fn is_intake_branch_recognises_both_prefixes() {
        assert!(is_intake_branch("intake/sample-bot-2024-01-01"));
        assert!(is_intake_branch("sb-intake/sample-bot/2024"));
        assert!(!is_intake_branch("develop"));
        assert!(!is_intake_branch("feature/foo"));
    }
}
