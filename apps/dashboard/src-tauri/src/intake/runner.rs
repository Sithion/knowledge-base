//! Phase A (intake) and Phase B (PR cut) orchestration.
//!
//! The runner sits on top of:
//!  - W4 `copilot_bridge` for spawning the agent subprocess
//!  - W3 `sb_freshness` for the pre-flight "is the SB up to date?" check
//!  - W5 `sb_clone` for the managed clone
//!  - W5 `intake::lock` for the single-instance flock
//!  - W5 `intake::audit` for run records
//!
//! UI is Wave-6's job — this module's contract is:
//!  - Tauri command callable inputs (`IntakeRunArgs`, `PrCutRunArgs`).
//!  - Two emitted Tauri events: `intake:event` (lifecycle progress) and the
//!    pass-through `agent-transcript-event` from W4 (UI must subscribe to
//!    both — we deliberately do NOT re-wrap transcript events here).
//!  - Two return shapes: [`IntakeResult`] and [`PrCutResult`].
//!
//! Lock semantics: each phase acquires the flock for the *spawn* window
//! only (it's released as soon as the run finishes — pass or fail). The
//! audit write is performed *after* the lock releases so a fast follow-up
//! Phase B isn't blocked waiting on disk.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::copilot_bridge::{spawn_copilot, CopilotArgs, SessionExitPayload};
use crate::sb_clone::ManagedCloneManager;
use crate::sb_freshness::{FreshnessEvent, SbFreshnessService};

use super::audit::{
    self, list_records, read_record, record_has_branch, AuditPaths, IntakeAuditRecord,
    IntakeStatus, PhaseKind,
};
use super::lock::{IntakeLock, LockError};

/// Tauri event name carrying lifecycle progress for the runner. This is
/// distinct from W4's `agent-transcript-event` — the UI subscribes to
/// both.
pub const INTAKE_EVENT_TOPIC: &str = "intake:event";

/// Inputs to `run_intake`. Caller (TS) controls staging via the inbox
/// flow; this struct only carries the per-run details.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakeRunArgs {
    pub project_slug: String,
    /// Files already copied into staging (or to-be-copied — the runner
    /// will copy them under `${managedClone}/00-Inbox/${project}/${runId}/`).
    pub inbox_files: Vec<PathBuf>,
    /// Override; falls back to `IntakePipelineConfig.intake_model`.
    pub model: Option<String>,
}

/// Inputs to `run_pr_cut`. Trivial — we look up the predecessor record
/// via `run_id` and run Phase B against its branch.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCutRunArgs {
    pub run_id: String,
    pub model: Option<String>,
}

/// Returned from `run_intake`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntakeResult {
    pub run_id: String,
    pub branch_name: String,
    pub transcript_path: String,
    pub audit_path: String,
    pub status: IntakeStatus,
    pub error_message: Option<String>,
}

/// Returned from `run_pr_cut`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrCutResult {
    pub run_id: String,
    pub pr_url: Option<String>,
    pub status: IntakeStatus,
    pub error_message: Option<String>,
}

/// Lifecycle event payload — UI maps `kind` to a status badge.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum IntakeLifecycleEvent {
    LockAcquired { run_id: String },
    PreflightFreshness { run_id: String },
    BranchCreated { run_id: String, branch: String, base_sha: String },
    FilesStaged { run_id: String, count: u32, staging_dir: String },
    Committed { run_id: String, message: String },
    AgentSpawning { run_id: String, model: String, phase: String },
    AgentExited { run_id: String, exit_code: Option<i32>, aborted: bool, timed_out: bool },
    PrUrlCaptured { run_id: String, pr_url: String },
    AuditWritten { run_id: String, audit_path: String },
    Aborted { run_id: String, reason: String },
    Failed { run_id: String, message: String },
    Completed { run_id: String, status: IntakeStatus },
}

/// Runner-level config. Resolved from `IntakePipelineConfig` on the TS
/// side; mirrored here so Rust can run with sensible defaults during
/// tests and standalone smoke-runs.
#[derive(Debug, Clone)]
pub struct IntakePipelineConfig {
    pub enable_sb_orchestration: bool,
    pub managed_clone_path: PathBuf,
    pub intake_model: String,
    pub pr_cut_model: String,
    pub intake_timeout_secs: u64,
    pub pr_cut_timeout_secs: u64,
    pub pr_cut_base_branch: String,
    /// Where audit records, transcripts, stderr logs live. Typically
    /// `${appDataDir}/intake-runs/`.
    pub audit_root: PathBuf,
    /// Path to the rendered intake prompt template. The runner reads
    /// the file and templates `{{project}}`, `{{run_id}}`, `{{managed_clone}}`,
    /// `{{staging_dir}}`. Falls back to a built-in minimal prompt on missing.
    pub intake_prompt_template: Option<PathBuf>,
    /// Path to the rendered Phase B prompt template. Falls back similarly.
    pub pr_cut_prompt_template: Option<PathBuf>,
}

impl Default for IntakePipelineConfig {
    fn default() -> Self {
        Self {
            enable_sb_orchestration: false,
            managed_clone_path: PathBuf::new(),
            intake_model: "auto".into(),
            pr_cut_model: "auto".into(),
            intake_timeout_secs: 1800,
            pr_cut_timeout_secs: 600,
            pr_cut_base_branch: "develop".into(),
            audit_root: PathBuf::new(),
            intake_prompt_template: None,
            pr_cut_prompt_template: None,
        }
    }
}

/// Tauri-managed state. Cheap to clone (Arc inside).
#[derive(Clone)]
pub struct IntakeService {
    inner: Arc<Inner>,
}

struct Inner {
    config: Mutex<IntakePipelineConfig>,
    /// Process-local mutex around the whole pipeline so two UI clicks in
    /// the same instance can't race. Cross-instance exclusion is the OS
    /// flock's job.
    op_lock: Mutex<()>,
    clone_manager: ManagedCloneManager,
    freshness: SbFreshnessService,
}

impl IntakeService {
    pub fn new(
        config: IntakePipelineConfig,
        clone_manager: ManagedCloneManager,
        freshness: SbFreshnessService,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                config: Mutex::new(config),
                op_lock: Mutex::new(()),
                clone_manager,
                freshness,
            }),
        }
    }

    pub async fn replace_config(&self, config: IntakePipelineConfig) {
        let mut g = self.inner.config.lock().await;
        *g = config;
    }

    pub async fn config_snapshot(&self) -> IntakePipelineConfig {
        self.inner.config.lock().await.clone()
    }

    pub fn clone_manager(&self) -> &ManagedCloneManager {
        &self.inner.clone_manager
    }

    pub fn audit_paths(&self, cfg: &IntakePipelineConfig) -> AuditPaths {
        AuditPaths::new(cfg.audit_root.join("intake-audit"))
    }

    pub fn run_dir(&self, cfg: &IntakePipelineConfig, run_id: &str) -> PathBuf {
        cfg.audit_root.join("intake-runs").join(run_id)
    }

    /// Phase A — staging + intake agent spawn.
    pub async fn run_intake(
        &self,
        args: IntakeRunArgs,
        app: AppHandle,
    ) -> Result<IntakeResult, String> {
        // Process-local mutex first.
        let _local = self.inner.op_lock.lock().await;

        let cfg = self.inner.config.lock().await.clone();
        if !cfg.enable_sb_orchestration {
            return Err("intake disabled (enableSbOrchestration is false)".into());
        }
        if !cfg.managed_clone_path.is_dir() {
            return Err(format!(
                "managed clone is not initialized at {} — run sb_clone_ensure first",
                cfg.managed_clone_path.display()
            ));
        }

        let run_id = format!("intake-{}", uuid::Uuid::new_v4());
        let audit_paths = self.audit_paths(&cfg);
        let run_dir = self.run_dir(&cfg, &run_id);
        tokio::fs::create_dir_all(&run_dir)
            .await
            .map_err(|e| format!("failed to create run dir: {e}"))?;

        let mut record = IntakeAuditRecord::new(
            run_id.clone(),
            args.project_slug.clone(),
            PhaseKind::IntakeA,
            args.model
                .clone()
                .unwrap_or_else(|| cfg.intake_model.clone()),
            cfg.managed_clone_path.display().to_string(),
        );
        record.status = IntakeStatus::Running;

        // Acquire OS-level flock around mutating ops. Released on drop.
        let lock = match IntakeLock::acquire(&cfg.managed_clone_path) {
            Ok(l) => l,
            Err(LockError::Busy) => {
                let msg = "another CogniStore instance is using the managed clone".to_string();
                record.status = IntakeStatus::Aborted;
                record.error_message = Some(msg.clone());
                record.finished_at = Some(chrono::Utc::now().to_rfc3339());
                let _ = audit::write_record(&audit_paths, &record).await;
                emit(&app, IntakeLifecycleEvent::Aborted { run_id: run_id.clone(), reason: msg.clone() });
                return Err(msg);
            }
            Err(e) => {
                let msg = format!("lock error: {e}");
                record.status = IntakeStatus::Failed;
                record.error_message = Some(msg.clone());
                record.finished_at = Some(chrono::Utc::now().to_rfc3339());
                let _ = audit::write_record(&audit_paths, &record).await;
                emit(&app, IntakeLifecycleEvent::Failed { run_id: run_id.clone(), message: msg.clone() });
                return Err(msg);
            }
        };
        emit(&app, IntakeLifecycleEvent::LockAcquired { run_id: run_id.clone() });

        // Pre-flight freshness check (observational; does not auto-pull).
        emit(&app, IntakeLifecycleEvent::PreflightFreshness { run_id: run_id.clone() });
        let fresh = self.inner.freshness.check_freshness().await;
        if let Some(behind) = freshness_behind(&fresh) {
            if behind > 0 {
                let msg = format!(
                    "Second Brain is {} commit(s) behind origin. Pull-and-import first via the freshness UI.",
                    behind
                );
                drop(lock);
                record.status = IntakeStatus::Failed;
                record.error_message = Some(msg.clone());
                record.finished_at = Some(chrono::Utc::now().to_rfc3339());
                let _ = audit::write_record(&audit_paths, &record).await;
                emit(&app, IntakeLifecycleEvent::Failed { run_id: run_id.clone(), message: msg.clone() });
                return Err(msg);
            }
        }

        // Branch creation.
        let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let branch = format!("intake/{}-{}", sanitize_slug(&args.project_slug), timestamp);
        match prepare_branch(&cfg.managed_clone_path, &branch).await {
            Ok(base_sha) => {
                record.branch_name = Some(branch.clone());
                record.base_sha = Some(base_sha.clone());
                emit(
                    &app,
                    IntakeLifecycleEvent::BranchCreated {
                        run_id: run_id.clone(),
                        branch: branch.clone(),
                        base_sha,
                    },
                );
            }
            Err(e) => {
                drop(lock);
                let msg = format!("failed to prepare intake branch: {e}");
                record.status = IntakeStatus::Failed;
                record.error_message = Some(msg.clone());
                record.finished_at = Some(chrono::Utc::now().to_rfc3339());
                let _ = audit::write_record(&audit_paths, &record).await;
                emit(&app, IntakeLifecycleEvent::Failed { run_id: run_id.clone(), message: msg.clone() });
                return Err(msg);
            }
        }

        // Stage inbox files.
        let staging_dir = cfg
            .managed_clone_path
            .join("00-Inbox")
            .join(sanitize_slug(&args.project_slug))
            .join(&run_id);
        if let Err(e) = tokio::fs::create_dir_all(&staging_dir).await {
            drop(lock);
            return self
                .fail_record(&audit_paths, &mut record, &app, format!("staging mkdir: {e}"))
                .await;
        }
        let mut staged: u32 = 0;
        for src in &args.inbox_files {
            let Some(name) = src.file_name() else { continue };
            let dst = staging_dir.join(name);
            match tokio::fs::copy(src, &dst).await {
                Ok(_) => staged += 1,
                Err(e) => {
                    drop(lock);
                    return self
                        .fail_record(
                            &audit_paths,
                            &mut record,
                            &app,
                            format!("copy {} -> {}: {}", src.display(), dst.display(), e),
                        )
                        .await;
                }
            }
        }
        record.file_count = staged;
        emit(
            &app,
            IntakeLifecycleEvent::FilesStaged {
                run_id: run_id.clone(),
                count: staged,
                staging_dir: staging_dir.display().to_string(),
            },
        );

        // Commit the staged files (so the agent's diff is rebased from them).
        let commit_msg = format!("intake: stage {staged} file(s) for {}", args.project_slug);
        if let Err(e) = git_add_commit_all(&cfg.managed_clone_path, &commit_msg).await {
            // Empty commit is fine (no files); only hard-fail on actual git errors.
            if !e.contains("nothing to commit") {
                drop(lock);
                return self
                    .fail_record(&audit_paths, &mut record, &app, format!("git commit: {e}"))
                    .await;
            }
        }
        emit(
            &app,
            IntakeLifecycleEvent::Committed {
                run_id: run_id.clone(),
                message: commit_msg,
            },
        );

        // Spawn copilot. The lock stays held until spawn returns (the
        // ChildHandle keeps the subprocess alive independently; the lock
        // is then released so a follow-up Phase B can acquire it cleanly
        // — Phase B only runs after Phase A's child has exited, so the
        // serialization is preserved by the audit-record gating).
        let prompt = render_intake_prompt(&cfg, &args.project_slug, &run_id, &staging_dir);
        let model = args.model.unwrap_or(cfg.intake_model.clone());
        let transcript_path = run_dir.join("copilot-session.intake.md");
        let stderr_log = run_dir.join("copilot-session.intake.stderr.log");

        emit(
            &app,
            IntakeLifecycleEvent::AgentSpawning {
                run_id: run_id.clone(),
                model: model.clone(),
                phase: "intake".into(),
            },
        );

        let copilot_args = CopilotArgs {
            agent: "mojito:second-brain".into(),
            model: model.clone(),
            prompt,
            add_dirs: vec![cfg.managed_clone_path.clone(), staging_dir.clone()],
            share_path: transcript_path.clone(),
            session_id: run_id.clone(),
            phase: "intake".into(),
            timeout_secs: cfg.intake_timeout_secs,
            stderr_log_path: stderr_log.clone(),
            cwd: cfg.managed_clone_path.clone(),
        };

        record.transcript_path = Some(transcript_path.display().to_string());
        record.stderr_log_path = Some(stderr_log.display().to_string());
        record.share_path = Some(transcript_path.display().to_string());

        let exit_payload = match run_copilot_to_completion(copilot_args, app.clone()).await {
            Ok((pid, payload)) => {
                record.copilot_pid_at_start = Some(pid);
                payload
            }
            Err(e) => {
                drop(lock);
                return self
                    .fail_record(&audit_paths, &mut record, &app, format!("spawn copilot: {e}"))
                    .await;
            }
        };

        emit(
            &app,
            IntakeLifecycleEvent::AgentExited {
                run_id: run_id.clone(),
                exit_code: exit_payload.exit_code,
                aborted: exit_payload.aborted,
                timed_out: exit_payload.timed_out,
            },
        );

        record.finished_at = Some(chrono::Utc::now().to_rfc3339());
        record.status = if exit_payload.timed_out {
            IntakeStatus::TimedOut
        } else if exit_payload.aborted {
            IntakeStatus::Aborted
        } else if matches!(exit_payload.exit_code, Some(0)) {
            IntakeStatus::Succeeded
        } else {
            IntakeStatus::Failed
        };

        drop(lock);
        let audit_path = audit::write_record(&audit_paths, &record)
            .await
            .map_err(|e| e.to_string())?;
        emit(
            &app,
            IntakeLifecycleEvent::AuditWritten {
                run_id: run_id.clone(),
                audit_path: audit_path.display().to_string(),
            },
        );
        emit(
            &app,
            IntakeLifecycleEvent::Completed {
                run_id: run_id.clone(),
                status: record.status.clone(),
            },
        );

        Ok(IntakeResult {
            run_id,
            branch_name: record.branch_name.clone().unwrap_or_default(),
            transcript_path: record.transcript_path.clone().unwrap_or_default(),
            audit_path: audit_path.display().to_string(),
            status: record.status,
            error_message: record.error_message,
        })
    }

    /// Phase B — push branch and open draft PR.
    pub async fn run_pr_cut(
        &self,
        args: PrCutRunArgs,
        app: AppHandle,
    ) -> Result<PrCutResult, String> {
        let _local = self.inner.op_lock.lock().await;
        let cfg = self.inner.config.lock().await.clone();
        if !cfg.enable_sb_orchestration {
            return Err("intake disabled (enableSbOrchestration is false)".into());
        }
        let audit_paths = self.audit_paths(&cfg);
        let parent = read_record(&audit_paths, &args.run_id)
            .await
            .map_err(|e| e.to_string())?;
        if !record_has_branch(&parent) {
            return Err(format!(
                "audit record {} has no branch — Phase A may not have run",
                args.run_id
            ));
        }
        let branch = parent.branch_name.clone().unwrap_or_default();

        // Verify branch exists locally
        let exists = Command::new("git")
            .args(["rev-parse", "--verify", &format!("refs/heads/{}", branch)])
            .current_dir(&cfg.managed_clone_path)
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !exists {
            return Err(format!(
                "branch {} does not exist in managed clone — was it discarded?",
                branch
            ));
        }

        let pr_run_id = format!("pr-cut-{}", uuid::Uuid::new_v4());
        let run_dir = self.run_dir(&cfg, &pr_run_id);
        tokio::fs::create_dir_all(&run_dir)
            .await
            .map_err(|e| format!("failed to create run dir: {e}"))?;

        let mut record = IntakeAuditRecord::new(
            pr_run_id.clone(),
            parent.project_slug.clone(),
            PhaseKind::PrCutB,
            args.model.clone().unwrap_or_else(|| cfg.pr_cut_model.clone()),
            cfg.managed_clone_path.display().to_string(),
        );
        record.parent_run_id = Some(args.run_id.clone());
        record.branch_name = Some(branch.clone());
        record.base_sha = parent.base_sha.clone();
        record.status = IntakeStatus::Running;

        let lock = match IntakeLock::acquire(&cfg.managed_clone_path) {
            Ok(l) => l,
            Err(LockError::Busy) => {
                let msg = "another CogniStore instance is using the managed clone".to_string();
                record.status = IntakeStatus::Aborted;
                record.error_message = Some(msg.clone());
                record.finished_at = Some(chrono::Utc::now().to_rfc3339());
                let _ = audit::write_record(&audit_paths, &record).await;
                emit(&app, IntakeLifecycleEvent::Aborted { run_id: pr_run_id.clone(), reason: msg.clone() });
                return Err(msg);
            }
            Err(e) => return Err(format!("lock error: {e}")),
        };
        emit(&app, IntakeLifecycleEvent::LockAcquired { run_id: pr_run_id.clone() });

        // Checkout the intake branch.
        if let Err(e) = git_run(&cfg.managed_clone_path, &["checkout", &branch]).await {
            drop(lock);
            let msg = format!("checkout {branch}: {e}");
            record.status = IntakeStatus::Failed;
            record.error_message = Some(msg.clone());
            record.finished_at = Some(chrono::Utc::now().to_rfc3339());
            let _ = audit::write_record(&audit_paths, &record).await;
            emit(&app, IntakeLifecycleEvent::Failed { run_id: pr_run_id.clone(), message: msg.clone() });
            return Err(msg);
        }

        let prompt = render_pr_cut_prompt(&cfg, &parent, &branch);
        let model = args.model.unwrap_or(cfg.pr_cut_model.clone());
        let transcript_path = run_dir.join("copilot-session.pr-cut.md");
        let stderr_log = run_dir.join("copilot-session.pr-cut.stderr.log");

        emit(
            &app,
            IntakeLifecycleEvent::AgentSpawning {
                run_id: pr_run_id.clone(),
                model: model.clone(),
                phase: "pr-cut".into(),
            },
        );

        let copilot_args = CopilotArgs {
            agent: "mojito:second-brain".into(),
            model: model.clone(),
            prompt,
            add_dirs: vec![cfg.managed_clone_path.clone()],
            share_path: transcript_path.clone(),
            session_id: pr_run_id.clone(),
            phase: "pr-cut".into(),
            timeout_secs: cfg.pr_cut_timeout_secs,
            stderr_log_path: stderr_log.clone(),
            cwd: cfg.managed_clone_path.clone(),
        };

        record.transcript_path = Some(transcript_path.display().to_string());
        record.stderr_log_path = Some(stderr_log.display().to_string());
        record.share_path = Some(transcript_path.display().to_string());

        let exit_payload = match run_copilot_to_completion(copilot_args, app.clone()).await {
            Ok((pid, payload)) => {
                record.copilot_pid_at_start = Some(pid);
                payload
            }
            Err(e) => {
                drop(lock);
                let msg = format!("spawn copilot: {e}");
                record.status = IntakeStatus::Failed;
                record.error_message = Some(msg.clone());
                record.finished_at = Some(chrono::Utc::now().to_rfc3339());
                let _ = audit::write_record(&audit_paths, &record).await;
                emit(&app, IntakeLifecycleEvent::Failed { run_id: pr_run_id.clone(), message: msg.clone() });
                return Err(msg);
            }
        };
        emit(
            &app,
            IntakeLifecycleEvent::AgentExited {
                run_id: pr_run_id.clone(),
                exit_code: exit_payload.exit_code,
                aborted: exit_payload.aborted,
                timed_out: exit_payload.timed_out,
            },
        );

        // Parse PR URL from the share file.
        let pr_url = if transcript_path.exists() {
            tokio::fs::read_to_string(&transcript_path)
                .await
                .ok()
                .and_then(|s| extract_pr_url(&s))
        } else {
            None
        };
        if let Some(url) = pr_url.clone() {
            emit(
                &app,
                IntakeLifecycleEvent::PrUrlCaptured {
                    run_id: pr_run_id.clone(),
                    pr_url: url,
                },
            );
        }
        record.pr_url = pr_url.clone();
        record.finished_at = Some(chrono::Utc::now().to_rfc3339());
        record.status = if exit_payload.timed_out {
            IntakeStatus::TimedOut
        } else if exit_payload.aborted {
            IntakeStatus::Aborted
        } else if matches!(exit_payload.exit_code, Some(0)) && pr_url.is_some() {
            IntakeStatus::Succeeded
        } else if matches!(exit_payload.exit_code, Some(0)) {
            // Exit 0 but no PR URL detected — record as failed so UI surfaces.
            record.error_message =
                Some("agent exited cleanly but no PR URL was found in the transcript".into());
            IntakeStatus::Failed
        } else {
            IntakeStatus::Failed
        };

        // Update the parent (Phase A) record with the PR URL pointer too.
        if let Some(url) = &pr_url {
            if let Ok(mut parent_rec) = read_record(&audit_paths, &args.run_id).await {
                parent_rec.pr_url = Some(url.clone());
                let _ = audit::write_record(&audit_paths, &parent_rec).await;
            }
        }

        drop(lock);
        let audit_path = audit::write_record(&audit_paths, &record)
            .await
            .map_err(|e| e.to_string())?;
        emit(
            &app,
            IntakeLifecycleEvent::AuditWritten {
                run_id: pr_run_id.clone(),
                audit_path: audit_path.display().to_string(),
            },
        );
        emit(
            &app,
            IntakeLifecycleEvent::Completed {
                run_id: pr_run_id.clone(),
                status: record.status.clone(),
            },
        );

        Ok(PrCutResult {
            run_id: pr_run_id,
            pr_url,
            status: record.status,
            error_message: record.error_message,
        })
    }

    pub async fn list_audit_records(&self) -> Result<Vec<IntakeAuditRecord>, String> {
        let cfg = self.inner.config.lock().await.clone();
        list_records(&self.audit_paths(&cfg))
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_audit_record(&self, run_id: &str) -> Result<IntakeAuditRecord, String> {
        let cfg = self.inner.config.lock().await.clone();
        read_record(&self.audit_paths(&cfg), run_id)
            .await
            .map_err(|e| e.to_string())
    }

    async fn fail_record(
        &self,
        audit_paths: &AuditPaths,
        record: &mut IntakeAuditRecord,
        app: &AppHandle,
        msg: String,
    ) -> Result<IntakeResult, String> {
        record.status = IntakeStatus::Failed;
        record.error_message = Some(msg.clone());
        record.finished_at = Some(chrono::Utc::now().to_rfc3339());
        let _ = audit::write_record(audit_paths, record).await;
        emit(app, IntakeLifecycleEvent::Failed { run_id: record.run_id.clone(), message: msg.clone() });
        Err(msg)
    }
}

fn emit(app: &AppHandle, ev: IntakeLifecycleEvent) {
    let _ = app.emit(INTAKE_EVENT_TOPIC, &ev);
}

fn sanitize_slug(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

fn freshness_behind(events: &[FreshnessEvent]) -> Option<u32> {
    events.iter().rev().find_map(|e| match e {
        FreshnessEvent::CheckComplete { commits_behind, .. } => Some(*commits_behind),
        _ => None,
    })
}

async fn prepare_branch(clone_path: &Path, branch: &str) -> Result<String, String> {
    // We assume someone already fetched origin/develop via the freshness
    // check in run_intake. Here we just create the branch from current HEAD.
    let head = git_capture(clone_path, &["rev-parse", "HEAD"]).await?;
    git_run(clone_path, &["checkout", "-b", branch]).await?;
    Ok(head.trim().to_string())
}

async fn git_run(cwd: &Path, args: &[&str]) -> Result<(), String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| format!("invoke git: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

async fn git_capture(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| format!("invoke git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

async fn git_add_commit_all(cwd: &Path, msg: &str) -> Result<(), String> {
    git_run(cwd, &["add", "-A"]).await?;
    let out = Command::new("git")
        .args(["commit", "-m", msg])
        .current_dir(cwd)
        .output()
        .await
        .map_err(|e| format!("invoke git commit: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if stdout.contains("nothing to commit") || stderr.contains("nothing to commit") {
        return Err("nothing to commit".into());
    }
    Err(stderr.trim().to_string())
}

const DEFAULT_INTAKE_PROMPT: &str = "MODE: managed-intake\n\nYou are running inside the CogniStore-managed Second Brain clone.\n\nProject: {{project}}\nRun id: {{run_id}}\nManaged clone: {{managed_clone}}\nStaging dir: {{staging_dir}}\n\nFollow the standard mojito:second-brain intake flow on the staged files in the staging dir: classify, extract requirements, update analysis, draft DRs as needed.\n\nMUST NOT: commit, push, or open any PR. CogniStore performs those after a human review step.\n";

const DEFAULT_PR_CUT_PROMPT: &str = "MODE: managed-pr-cut\n\nYou are cutting a PR for an already-staged intake branch.\n\nProject: {{project}}\nBranch: {{branch}}\nBase: {{base_branch}}\nManaged clone: {{managed_clone}}\nParent run id: {{parent_run_id}}\n\nDo NOT perform any analysis. Only:\n1. Stage all working-tree changes.\n2. Commit them with a templated message referencing the project and run id.\n3. Push the branch to origin.\n4. Open a draft PR via `gh pr create --draft --base {{base_branch}}` with a useful title and body.\n5. Print the PR URL on a line of its own so it can be parsed.\n";

fn render_intake_prompt(
    cfg: &IntakePipelineConfig,
    project: &str,
    run_id: &str,
    staging_dir: &Path,
) -> String {
    let template = cfg
        .intake_prompt_template
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_else(|| DEFAULT_INTAKE_PROMPT.to_string());
    template
        .replace("{{project}}", project)
        .replace("{{run_id}}", run_id)
        .replace("{{managed_clone}}", &cfg.managed_clone_path.display().to_string())
        .replace("{{staging_dir}}", &staging_dir.display().to_string())
}

fn render_pr_cut_prompt(
    cfg: &IntakePipelineConfig,
    parent: &IntakeAuditRecord,
    branch: &str,
) -> String {
    let template = cfg
        .pr_cut_prompt_template
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_else(|| DEFAULT_PR_CUT_PROMPT.to_string());
    template
        .replace("{{project}}", &parent.project_slug)
        .replace("{{branch}}", branch)
        .replace("{{base_branch}}", &cfg.pr_cut_base_branch)
        .replace("{{managed_clone}}", &cfg.managed_clone_path.display().to_string())
        .replace("{{parent_run_id}}", &parent.run_id)
}

/// Spawn copilot, wait for the `agent-session-exit` Tauri event, and
/// return its payload along with the child PID. We use a one-shot listener
/// so we don't have to thread cross-task plumbing through W4's bridge.
async fn run_copilot_to_completion(
    args: CopilotArgs,
    app: AppHandle,
) -> Result<(u32, SessionExitPayload), String> {
    use crate::copilot_bridge::spawn::SESSION_EXIT_EVENT_NAME;
    use tokio::sync::oneshot;

    let session_id = args.session_id.clone();
    let (tx, rx) = oneshot::channel::<SessionExitPayload>();
    let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));

    // Note: tauri::Listener::listen returns an EventId; we keep the handle
    // implicitly via the `Listener` trait (the listener auto-unregisters
    // when matching events stop arriving — we explicitly unlisten after fire).
    use tauri::Listener;
    let listener_id = {
        let tx = tx.clone();
        let session_id = session_id.clone();
        app.listen(SESSION_EXIT_EVENT_NAME, move |evt| {
            let payload_str = evt.payload();
            if let Ok(p) = serde_json::from_str::<SessionExitPayload>(payload_str) {
                if p.session_id == session_id {
                    if let Ok(mut g) = tx.lock() {
                        if let Some(s) = g.take() {
                            let _ = s.send(p);
                        }
                    }
                }
            }
        })
    };

    let handle = spawn_copilot(args, app.clone()).await.map_err(|e| e.to_string())?;
    let pid = handle.pid;

    let payload = rx.await.map_err(|_| "session-exit listener dropped".to_string())?;
    app.unlisten(listener_id);
    Ok((pid, payload))
}

/// Pull the first GitHub PR URL from a transcript blob. Matches both
/// `https://github.com/owner/repo/pull/N` and the `gh pr create` standard
/// output (which prints a single URL on a line of its own).
fn extract_pr_url(blob: &str) -> Option<String> {
    // Cheap, non-regex scan — find `https://github.com/` substrings and
    // walk to whitespace.
    let needle = "https://github.com/";
    let start = blob.find(needle)?;
    let tail = &blob[start..];
    let end = tail
        .find(|c: char| c.is_whitespace() || c == ')' || c == ']' || c == '"' || c == '\'')
        .unwrap_or(tail.len());
    let url = tail[..end].trim_end_matches(|c| c == '.' || c == ',');
    if url.contains("/pull/") || url.contains("/pulls/") {
        Some(url.to_string())
    } else {
        // Could be a repo URL etc. — keep scanning.
        let rest = &blob[start + needle.len() + 1..];
        extract_pr_url(rest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_pr_url_finds_standard_gh_url() {
        let blob = "Creating pull request for...\nhttps://github.com/your-org/sb/pull/42\n";
        assert_eq!(
            extract_pr_url(blob),
            Some("https://github.com/your-org/sb/pull/42".into())
        );
    }

    #[test]
    fn extract_pr_url_skips_non_pr_urls() {
        let blob = "See https://github.com/your-org/sb for the repo. PR: https://github.com/your-org/sb/pull/7.";
        assert_eq!(
            extract_pr_url(blob),
            Some("https://github.com/your-org/sb/pull/7".into())
        );
    }

    #[test]
    fn extract_pr_url_returns_none_on_no_match() {
        assert_eq!(extract_pr_url("nothing here"), None);
    }

    #[test]
    fn sanitize_slug_replaces_unsafe_chars() {
        assert_eq!(sanitize_slug("sample-bot"), "sample-bot");
        assert_eq!(sanitize_slug("foo/bar baz"), "foo-bar-baz");
        assert_eq!(sanitize_slug("../../etc"), "------etc");
    }

    #[test]
    fn freshness_behind_extracts_from_check_complete() {
        let evs = vec![
            FreshnessEvent::CheckStarted { ts: "x".into() },
            FreshnessEvent::CheckComplete {
                ts: "y".into(),
                local_sha: "a".into(),
                remote_sha: "b".into(),
                is_behind: true,
                commits_behind: 5,
            },
        ];
        assert_eq!(freshness_behind(&evs), Some(5));
    }

    #[test]
    fn freshness_behind_returns_none_if_no_check_complete() {
        let evs: Vec<FreshnessEvent> = vec![];
        assert_eq!(freshness_behind(&evs), None);
    }

    #[test]
    fn render_intake_prompt_substitutes_placeholders() {
        let cfg = IntakePipelineConfig {
            managed_clone_path: PathBuf::from("/clone"),
            ..IntakePipelineConfig::default()
        };
        let p = render_intake_prompt(&cfg, "sample-bot", "run-1", Path::new("/clone/00-Inbox/sb"));
        assert!(p.contains("sample-bot"));
        assert!(p.contains("run-1"));
        assert!(p.contains("/clone/00-Inbox/sb"));
        assert!(p.starts_with("MODE: managed-intake"));
    }

    #[test]
    fn render_pr_cut_prompt_substitutes_branch_and_base() {
        let cfg = IntakePipelineConfig {
            pr_cut_base_branch: "test/intake-poc-base".into(),
            managed_clone_path: PathBuf::from("/clone"),
            ..IntakePipelineConfig::default()
        };
        let parent = IntakeAuditRecord::new(
            "parent-1".into(),
            "sample-bot".into(),
            PhaseKind::IntakeA,
            "auto".into(),
            "/clone".into(),
        );
        let p = render_pr_cut_prompt(&cfg, &parent, "intake/sample-bot-x");
        assert!(p.starts_with("MODE: managed-pr-cut"));
        assert!(p.contains("intake/sample-bot-x"));
        assert!(p.contains("test/intake-poc-base"));
        assert!(p.contains("parent-1"));
    }
}
