//! `SbFreshnessService` — thin wrapper over `git` and the SB sync script.
//!
//! Holds a single in-process mutex so two callers (e.g. launch hook + a UI
//! "Check freshness" click landing simultaneously) can't race on the same
//! managed clone. The mutex guards the actual git/spawn IO; cached status
//! reads are lock-free.
//!
//! Path resolution:
//!  - `secondBrainPath`  → user-configured local checkout (read-only display).
//!    Wave-3 treats this as the working clone for the freshness pipeline,
//!    matching the dashboard config surface from Wave 1. Once Wave-5 lands
//!    a managed clone under `${appDataDir}/second-brain-managed/` this can
//!    be retargeted.
//!
//! Wave-3 expressly does NOT auto-pull during before-use. The `check`
//! pipeline is observational; only `pull_latest` mutates the clone, and
//! only the explicit `sb_freshness_pull_and_import` command invokes that.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::sync::Mutex;

use super::events::{now_iso, FreshnessEvent, FreshnessFailureKind};

/// Configuration snapshot captured at construction time. The dashboard
/// re-creates the service on config change rather than mutating it in
/// place — keeps the service stateless apart from `cached_status`.
#[derive(Debug, Clone)]
pub struct FreshnessConfig {
    /// Filesystem path to the Second Brain checkout. May not exist —
    /// `check_freshness` reports `NotInitialized` instead of erroring.
    pub second_brain_path: Option<PathBuf>,
    /// Master gate — when false, every operation is a no-op + Disabled event.
    pub enable_sb_orchestration: bool,
    /// Branch to track. POC default: `develop`.
    pub branch: String,
    /// Optional override of the import script. Defaults to
    /// `${secondBrainPath}/_tools/sync/cognistore-sync.js`.
    pub sync_script: Option<PathBuf>,
}

impl Default for FreshnessConfig {
    fn default() -> Self {
        Self {
            second_brain_path: None,
            enable_sb_orchestration: false,
            branch: "develop".to_string(),
            sync_script: None,
        }
    }
}

/// Last-known status — what the dashboard health pane displays. Updated
/// after every `check_freshness` / `pull_latest` / `run_import_script`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FreshnessStatus {
    pub enabled: bool,
    pub configured_path: Option<String>,
    pub initialized: bool,
    pub local_sha: Option<String>,
    pub remote_sha: Option<String>,
    pub commits_behind: Option<u32>,
    pub last_checked_at: Option<String>,
    pub last_pulled_at: Option<String>,
    pub last_imported_at: Option<String>,
    pub last_error: Option<String>,
}

/// Tauri-managed state. Cheap to clone (Arc inside).
#[derive(Clone)]
pub struct SbFreshnessService {
    inner: Arc<Inner>,
}

struct Inner {
    config: Mutex<FreshnessConfig>,
    cached: Mutex<FreshnessStatus>,
    op_lock: Mutex<()>,
}

impl SbFreshnessService {
    pub fn new(config: FreshnessConfig) -> Self {
        let initial = FreshnessStatus {
            enabled: config.enable_sb_orchestration,
            configured_path: config
                .second_brain_path
                .as_ref()
                .map(|p| p.display().to_string()),
            ..Default::default()
        };
        Self {
            inner: Arc::new(Inner {
                config: Mutex::new(config),
                cached: Mutex::new(initial),
                op_lock: Mutex::new(()),
            }),
        }
    }

    pub async fn replace_config(&self, config: FreshnessConfig) {
        {
            let mut c = self.inner.cached.lock().await;
            c.enabled = config.enable_sb_orchestration;
            c.configured_path = config
                .second_brain_path
                .as_ref()
                .map(|p| p.display().to_string());
        }
        let mut g = self.inner.config.lock().await;
        *g = config;
    }

    pub async fn snapshot(&self) -> FreshnessStatus {
        self.inner.cached.lock().await.clone()
    }

    /// Validate gate + path; return `Err` event suitable for emit if not OK.
    async fn require_ready(&self) -> Result<PathBuf, FreshnessEvent> {
        let cfg = self.inner.config.lock().await.clone();
        if !cfg.enable_sb_orchestration {
            return Err(FreshnessEvent::failed(
                FreshnessFailureKind::Disabled,
                "enableSbOrchestration is false",
            ));
        }
        let Some(path) = cfg.second_brain_path else {
            return Err(FreshnessEvent::failed(
                FreshnessFailureKind::NotConfigured,
                "aiStack.secondBrainPath is not configured",
            ));
        };
        if !path.exists() {
            return Err(FreshnessEvent::failed(
                FreshnessFailureKind::NotInitialized,
                format!("Second Brain checkout not found at {}", path.display()),
            ));
        }
        if !path.join(".git").exists() {
            return Err(FreshnessEvent::failed(
                FreshnessFailureKind::NotInitialized,
                format!("Path is not a git repository: {}", path.display()),
            ));
        }
        Ok(path)
    }

    /// `git fetch && git rev-list --count HEAD..origin/<branch>`. Does not
    /// mutate the working tree. Updates cached status on success.
    pub async fn check_freshness(&self) -> Vec<FreshnessEvent> {
        let _guard = self.inner.op_lock.lock().await;
        let mut events = Vec::with_capacity(2);

        let path = match self.require_ready().await {
            Ok(p) => p,
            Err(e) => {
                self.record_failure(&e).await;
                events.push(e);
                return events;
            }
        };
        let branch = self.inner.config.lock().await.branch.clone();

        events.push(FreshnessEvent::CheckStarted { ts: now_iso() });

        if let Err(e) = git(&path, &["fetch", "--quiet", "origin", &branch]).await {
            let ev = FreshnessEvent::failed(FreshnessFailureKind::GitFailure, e);
            self.record_failure(&ev).await;
            events.push(ev);
            return events;
        }

        let local_sha = match git_capture(&path, &["rev-parse", "HEAD"]).await {
            Ok(s) => s.trim().to_string(),
            Err(e) => {
                let ev = FreshnessEvent::failed(FreshnessFailureKind::GitFailure, e);
                self.record_failure(&ev).await;
                events.push(ev);
                return events;
            }
        };

        let remote_ref = format!("origin/{}", branch);
        let remote_sha = match git_capture(&path, &["rev-parse", &remote_ref]).await {
            Ok(s) => s.trim().to_string(),
            Err(e) => {
                let ev = FreshnessEvent::failed(FreshnessFailureKind::GitFailure, e);
                self.record_failure(&ev).await;
                events.push(ev);
                return events;
            }
        };

        let count = match git_capture(
            &path,
            &["rev-list", "--count", &format!("HEAD..{}", remote_ref)],
        )
        .await
        {
            Ok(s) => s.trim().parse::<u32>().unwrap_or(0),
            Err(e) => {
                let ev = FreshnessEvent::failed(FreshnessFailureKind::GitFailure, e);
                self.record_failure(&ev).await;
                events.push(ev);
                return events;
            }
        };

        let ts = now_iso();
        {
            let mut c = self.inner.cached.lock().await;
            c.initialized = true;
            c.local_sha = Some(local_sha.clone());
            c.remote_sha = Some(remote_sha.clone());
            c.commits_behind = Some(count);
            c.last_checked_at = Some(ts.clone());
            c.last_error = None;
        }

        events.push(FreshnessEvent::CheckComplete {
            ts,
            local_sha,
            remote_sha,
            is_behind: count > 0,
            commits_behind: count,
        });
        events
    }

    /// `git pull --ff-only`. Caller is responsible for invoking
    /// `run_import_script` afterward; `commands.rs` chains them.
    pub async fn pull_latest(&self) -> Vec<FreshnessEvent> {
        let _guard = self.inner.op_lock.lock().await;
        let mut events = Vec::with_capacity(2);

        let path = match self.require_ready().await {
            Ok(p) => p,
            Err(e) => {
                self.record_failure(&e).await;
                events.push(e);
                return events;
            }
        };
        let branch = self.inner.config.lock().await.branch.clone();

        events.push(FreshnessEvent::PullStarted { ts: now_iso() });

        if let Err(e) = git(&path, &["fetch", "--quiet", "origin", &branch]).await {
            let ev = FreshnessEvent::failed(FreshnessFailureKind::GitFailure, e);
            self.record_failure(&ev).await;
            events.push(ev);
            return events;
        }

        let before = git_capture(&path, &["rev-parse", "HEAD"])
            .await
            .ok()
            .map(|s| s.trim().to_string());

        if let Err(e) = git(&path, &["pull", "--ff-only", "origin", &branch]).await {
            let ev = FreshnessEvent::failed(FreshnessFailureKind::GitFailure, e);
            self.record_failure(&ev).await;
            events.push(ev);
            return events;
        }

        let after = match git_capture(&path, &["rev-parse", "HEAD"]).await {
            Ok(s) => s.trim().to_string(),
            Err(e) => {
                let ev = FreshnessEvent::failed(FreshnessFailureKind::GitFailure, e);
                self.record_failure(&ev).await;
                events.push(ev);
                return events;
            }
        };

        let pulled = if let Some(b) = before.as_ref() {
            if b == &after {
                0
            } else {
                git_capture(&path, &["rev-list", "--count", &format!("{}..{}", b, after)])
                    .await
                    .ok()
                    .and_then(|s| s.trim().parse::<u32>().ok())
                    .unwrap_or(0)
            }
        } else {
            0
        };

        let ts = now_iso();
        {
            let mut c = self.inner.cached.lock().await;
            c.local_sha = Some(after.clone());
            c.commits_behind = Some(0);
            c.last_pulled_at = Some(ts.clone());
            c.last_error = None;
        }

        events.push(FreshnessEvent::PullComplete {
            ts,
            new_sha: after,
            commits_pulled: pulled,
        });
        events
    }

    /// Invoke the SB → CogniStore sync script. Wave-1 placed it at
    /// `${secondBrainPath}/_tools/sync/cognistore-sync.js`; if the file is
    /// missing we surface `SyncScriptFailure` so the UI can prompt for
    /// bootstrap.
    pub async fn run_import_script(&self) -> Vec<FreshnessEvent> {
        let _guard = self.inner.op_lock.lock().await;
        let mut events = Vec::with_capacity(2);

        let path = match self.require_ready().await {
            Ok(p) => p,
            Err(e) => {
                self.record_failure(&e).await;
                events.push(e);
                return events;
            }
        };
        let cfg = self.inner.config.lock().await.clone();
        let script = cfg
            .sync_script
            .clone()
            .unwrap_or_else(|| path.join("_tools/sync/cognistore-sync.js"));
        if !script.exists() {
            let ev = FreshnessEvent::failed(
                FreshnessFailureKind::SyncScriptFailure,
                format!("sync script not found: {}", script.display()),
            );
            self.record_failure(&ev).await;
            events.push(ev);
            return events;
        }

        events.push(FreshnessEvent::ImportStarted {
            ts: now_iso(),
            script_path: script.display().to_string(),
        });

        let output = Command::new("node")
            .arg(&script)
            .current_dir(&path)
            .output()
            .await;
        let output = match output {
            Ok(o) => o,
            Err(e) => {
                let ev = FreshnessEvent::failed(
                    FreshnessFailureKind::SyncScriptFailure,
                    format!("failed to spawn node: {}", e),
                );
                self.record_failure(&ev).await;
                events.push(ev);
                return events;
            }
        };

        let exit_code = output.status.code().unwrap_or(-1);
        let stdout_tail = tail_lossy(&output.stdout, 4_000);
        let stderr_tail = tail_lossy(&output.stderr, 4_000);

        let ts = now_iso();
        {
            let mut c = self.inner.cached.lock().await;
            c.last_imported_at = Some(ts.clone());
            if exit_code != 0 {
                c.last_error = Some(format!("sync script exit {}: {}", exit_code, stderr_tail));
            } else {
                c.last_error = None;
            }
        }

        events.push(FreshnessEvent::ImportComplete {
            ts,
            exit_code,
            stdout_tail,
            stderr_tail,
        });
        events
    }

    async fn record_failure(&self, ev: &FreshnessEvent) {
        if let FreshnessEvent::Failed { kind, message, .. } = ev {
            let mut c = self.inner.cached.lock().await;
            // Disabled / NotConfigured / NotInitialized are state, not error;
            // surface them via dedicated fields instead of last_error spam.
            match kind {
                FreshnessFailureKind::Disabled => {
                    c.enabled = false;
                }
                FreshnessFailureKind::NotInitialized => {
                    c.initialized = false;
                }
                _ => {
                    c.last_error = Some(message.clone());
                }
            }
        }
    }
}

async fn git(repo: &Path, args: &[&str]) -> Result<(), String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .await
        .map_err(|e| format!("failed to spawn git: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "git {:?} exit {}: {}",
            args,
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

async fn git_capture(repo: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .await
        .map_err(|e| format!("failed to spawn git: {}", e))?;
    if !out.status.success() {
        return Err(format!(
            "git {:?} exit {}: {}",
            args,
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn tail_lossy(buf: &[u8], max: usize) -> String {
    let s = String::from_utf8_lossy(buf);
    if s.len() <= max {
        return s.into_owned();
    }
    let start = s.len() - max;
    // Avoid splitting a multi-byte char by walking forward to next char boundary.
    let mut idx = start;
    while idx < s.len() && !s.is_char_boundary(idx) {
        idx += 1;
    }
    format!("…{}", &s[idx..])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn check_when_disabled_yields_disabled_failure() {
        let svc = SbFreshnessService::new(FreshnessConfig::default());
        let events = svc.check_freshness().await;
        assert_eq!(events.len(), 1);
        match &events[0] {
            FreshnessEvent::Failed { kind, .. } => {
                assert_eq!(*kind, FreshnessFailureKind::Disabled)
            }
            other => panic!("expected Failed(Disabled), got {:?}", other),
        }
        let snap = svc.snapshot().await;
        assert!(!snap.enabled);
    }

    #[tokio::test]
    async fn check_when_not_configured_yields_not_configured() {
        let svc = SbFreshnessService::new(FreshnessConfig {
            enable_sb_orchestration: true,
            ..FreshnessConfig::default()
        });
        let events = svc.check_freshness().await;
        match &events[0] {
            FreshnessEvent::Failed { kind, .. } => {
                assert_eq!(*kind, FreshnessFailureKind::NotConfigured)
            }
            other => panic!("expected Failed(NotConfigured), got {:?}", other),
        }
    }

    #[tokio::test]
    async fn check_when_path_missing_yields_not_initialized() {
        let svc = SbFreshnessService::new(FreshnessConfig {
            enable_sb_orchestration: true,
            second_brain_path: Some(PathBuf::from(
                "/nonexistent/sb-test-path-zzz-9999",
            )),
            ..FreshnessConfig::default()
        });
        let events = svc.check_freshness().await;
        match &events[0] {
            FreshnessEvent::Failed { kind, .. } => {
                assert_eq!(*kind, FreshnessFailureKind::NotInitialized)
            }
            other => panic!("expected Failed(NotInitialized), got {:?}", other),
        }
    }

    #[tokio::test]
    async fn check_when_path_exists_but_no_git_yields_not_initialized() {
        let dir = std::env::temp_dir().join(format!("sb-fresh-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let svc = SbFreshnessService::new(FreshnessConfig {
            enable_sb_orchestration: true,
            second_brain_path: Some(dir.clone()),
            ..FreshnessConfig::default()
        });
        let events = svc.check_freshness().await;
        match &events[0] {
            FreshnessEvent::Failed { kind, .. } => {
                assert_eq!(*kind, FreshnessFailureKind::NotInitialized)
            }
            other => panic!("expected Failed(NotInitialized), got {:?}", other),
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn snapshot_reflects_disabled_state() {
        let svc = SbFreshnessService::new(FreshnessConfig::default());
        let s = svc.snapshot().await;
        assert!(!s.enabled);
        assert!(s.configured_path.is_none());
        assert!(!s.initialized);
        assert!(s.local_sha.is_none());
    }

    #[tokio::test]
    async fn replace_config_updates_snapshot() {
        let svc = SbFreshnessService::new(FreshnessConfig::default());
        svc.replace_config(FreshnessConfig {
            enable_sb_orchestration: true,
            second_brain_path: Some(PathBuf::from("/tmp/some-path")),
            ..FreshnessConfig::default()
        })
        .await;
        let s = svc.snapshot().await;
        assert!(s.enabled);
        assert_eq!(s.configured_path.as_deref(), Some("/tmp/some-path"));
    }

    #[test]
    fn tail_lossy_within_limit_returns_unchanged() {
        let r = tail_lossy(b"hello", 100);
        assert_eq!(r, "hello");
    }

    #[test]
    fn tail_lossy_truncates_with_ellipsis() {
        let big = "abcdefghij".repeat(100); // 1000 chars
        let r = tail_lossy(big.as_bytes(), 50);
        assert!(r.starts_with('…'));
        assert!(r.len() <= 60);
    }
}
