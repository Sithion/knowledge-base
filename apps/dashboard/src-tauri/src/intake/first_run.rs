//! First-run setup detection.
//!
//! Probes the user's environment for the prerequisites the intake pipeline
//! needs:
//!  - Managed Second Brain clone exists and is healthy.
//!  - `copilot` CLI is installed and on `$PATH`.
//!  - `copilot auth status` reports authenticated.
//!  - `gh` CLI present (Phase B opens the PR via `gh pr create`).
//!
//! The Tauri command surfaces `FirstRunReport`; the UI renders it and gates
//! the **Process Inbox** button until all blocking steps clear. Probes run
//! in parallel — total wall-clock time should be ~max(probe_time), not the
//! sum.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::process::Command;
use tokio::time::timeout;

use crate::sb_clone::ManagedCloneManager;

const PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pass,
    Fail,
    Skipped,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstRunStep {
    pub id: String,
    pub label: String,
    pub status: StepStatus,
    pub detail: Option<String>,
    /// User-facing remediation snippet (markdown) when status != Pass.
    pub remediation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstRunReport {
    pub sb_clone_ready: bool,
    pub copilot_present: bool,
    pub copilot_authed: bool,
    pub gh_present: bool,
    pub blocking_steps: Vec<String>,
    pub steps: Vec<FirstRunStep>,
}

/// Run the full set of probes. Cheap; safe to call from the UI on demand.
pub async fn run_first_run_setup(clone_manager: &ManagedCloneManager) -> FirstRunReport {
    // Run all probes in parallel.
    let clone_status = clone_manager.get_clone_status();
    let copilot_version = probe_command("copilot", &["--version"]);
    let gh_version = probe_command("gh", &["--version"]);

    let (clone, copilot_ver, gh_ver) =
        tokio::join!(clone_status, copilot_version, gh_version);

    let mut steps = Vec::new();
    let mut blocking = Vec::new();

    // SB clone
    let sb_clone_ready = clone.exists && clone.is_git_repo;
    let sb_step = FirstRunStep {
        id: "sb-clone".into(),
        label: "Second Brain managed clone".into(),
        status: if sb_clone_ready { StepStatus::Pass } else { StepStatus::Fail },
        detail: Some(if !clone.exists {
            format!("Workspace dir missing: {}", clone.path)
        } else if !clone.is_git_repo {
            format!("Workspace exists but is not a git repository: {}", clone.path)
        } else {
            format!(
                "Healthy clone at {}{}",
                clone.path,
                clone
                    .current_branch
                    .as_ref()
                    .map(|b| format!(" (on {b})"))
                    .unwrap_or_default()
            )
        }),
        remediation: if !sb_clone_ready {
            Some(
                "Click **Set / change remote URL…** below, paste the Git URL of your Second Brain repository, and press **Save & clone**. CogniStore manages its own clone separate from any personal checkout.".into(),
            )
        } else {
            None
        },
    };
    if !sb_clone_ready {
        blocking.push(sb_step.id.clone());
    }
    steps.push(sb_step);

    // copilot CLI presence
    let copilot_present = matches!(copilot_ver, ProbeOutcome::Ok { .. });
    let copilot_step = FirstRunStep {
        id: "copilot-present".into(),
        label: "Copilot CLI installed".into(),
        status: if copilot_present { StepStatus::Pass } else { StepStatus::Fail },
        detail: copilot_ver.detail(),
        remediation: if !copilot_present {
            Some(install_copilot_snippet())
        } else {
            None
        },
    };
    if !copilot_present {
        blocking.push(copilot_step.id.clone());
    }
    steps.push(copilot_step);

    // copilot auth — the CLI provides no non-interactive auth-status probe
    // (only `copilot login` exists, which is interactive). We use a heuristic:
    // if the copilot config file exists and has been initialized, we assume
    // the user has logged in at least once. Real auth failures will surface
    // at first intake run with a clear error.
    let copilot_authed = if copilot_present {
        copilot_config_initialized().await
            || std::env::var("COPILOT_GITHUB_TOKEN").is_ok()
            || std::env::var("GH_TOKEN").is_ok()
            || std::env::var("GITHUB_TOKEN").is_ok()
    } else {
        false
    };
    let auth_step = FirstRunStep {
        id: "copilot-authed".into(),
        label: "Copilot CLI authenticated".into(),
        status: if !copilot_present {
            StepStatus::Skipped
        } else if copilot_authed {
            StepStatus::Pass
        } else {
            StepStatus::Fail
        },
        detail: Some(if !copilot_present {
            "skipped — copilot CLI not present".into()
        } else if copilot_authed {
            "config file present (auth verified at first use)".into()
        } else {
            "no config file found at ~/.copilot/config.json and no token env var set".into()
        }),
        remediation: if copilot_present && !copilot_authed {
            Some("Run `copilot login` in a terminal (it opens a browser), then click **Re-check**.".into())
        } else {
            None
        },
    };
    if copilot_present && !copilot_authed {
        blocking.push(auth_step.id.clone());
    }
    steps.push(auth_step);

    // gh CLI — only blocks Phase B; surface non-blocking but warned.
    let gh_present = matches!(gh_ver, ProbeOutcome::Ok { .. });
    steps.push(FirstRunStep {
        id: "gh-present".into(),
        label: "GitHub CLI (`gh`) installed".into(),
        status: if gh_present { StepStatus::Pass } else { StepStatus::Fail },
        detail: gh_ver.detail(),
        remediation: if !gh_present {
            Some(install_gh_snippet())
        } else {
            None
        },
    });
    if !gh_present {
        blocking.push("gh-present".into());
    }

    FirstRunReport {
        sb_clone_ready,
        copilot_present,
        copilot_authed,
        gh_present,
        blocking_steps: blocking,
        steps,
    }
}

#[derive(Debug, Clone)]
enum ProbeOutcome {
    Ok { out: String },
    Failed { detail: String },
    NotFound,
    Timeout,
}

impl ProbeOutcome {
    fn detail(&self) -> Option<String> {
        match self {
            ProbeOutcome::Ok { out } => Some(out.lines().next().unwrap_or("").trim().to_string()),
            ProbeOutcome::Failed { detail } => Some(detail.clone()),
            ProbeOutcome::NotFound => Some("not found on PATH".to_string()),
            ProbeOutcome::Timeout => Some("probe timed out".to_string()),
        }
    }
}

/// Best-effort heuristic: treat copilot as authenticated if its config
/// file exists at `~/.copilot/config.json`. The CLI writes this on first
/// launch, so the presence of `firstLaunchAt` is a strong signal the user
/// has interacted with the CLI at least once.
async fn copilot_config_initialized() -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    let cfg = home.join(".copilot").join("config.json");
    match tokio::fs::read_to_string(&cfg).await {
        Ok(s) => s.contains("firstLaunchAt"),
        Err(_) => false,
    }
}

async fn probe_command(bin: &str, args: &[&str]) -> ProbeOutcome {
    let fut = Command::new(bin).args(args).output();
    match timeout(PROBE_TIMEOUT, fut).await {
        Err(_) => ProbeOutcome::Timeout,
        Ok(Err(e)) => {
            // Most common case: ENOENT (binary not on PATH).
            if e.kind() == std::io::ErrorKind::NotFound {
                ProbeOutcome::NotFound
            } else {
                ProbeOutcome::Failed { detail: e.to_string() }
            }
        }
        Ok(Ok(out)) => {
            if out.status.success() {
                ProbeOutcome::Ok {
                    out: String::from_utf8_lossy(&out.stdout).into_owned(),
                }
            } else {
                let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
                ProbeOutcome::Failed {
                    detail: stderr.trim().to_string(),
                }
            }
        }
    }
}

fn install_copilot_snippet() -> String {
    if cfg!(target_os = "macos") {
        "Install Copilot CLI via Homebrew:\n\n```sh\nbrew install gh\ngh extension install github/copilot\n```\n\nThen run `gh copilot --help` to verify.".into()
    } else if cfg!(target_os = "windows") {
        "Install Copilot CLI:\n\n```powershell\nwinget install GitHub.cli\ngh extension install github/copilot\n```\n\nFull docs: https://docs.github.com/en/copilot/github-copilot-in-the-cli".into()
    } else {
        "Install GitHub CLI for your distribution (https://cli.github.com), then run:\n\n```sh\ngh extension install github/copilot\n```".into()
    }
}

fn install_gh_snippet() -> String {
    if cfg!(target_os = "macos") {
        "Install GitHub CLI via Homebrew:\n\n```sh\nbrew install gh\n```".into()
    } else if cfg!(target_os = "windows") {
        "Install GitHub CLI:\n\n```powershell\nwinget install GitHub.cli\n```".into()
    } else {
        "Install GitHub CLI for your distribution: https://cli.github.com".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn probe_unknown_binary_is_not_found() {
        let r = probe_command("definitely-not-a-binary-xyzzy", &["--version"]).await;
        assert!(matches!(r, ProbeOutcome::NotFound | ProbeOutcome::Failed { .. }));
    }

    #[tokio::test]
    async fn report_with_uninitialised_clone_marks_sb_blocking() {
        let m = ManagedCloneManager::new(crate::sb_clone::CloneConfig::default());
        let r = run_first_run_setup(&m).await;
        assert!(!r.sb_clone_ready);
        assert!(r.blocking_steps.iter().any(|s| s == "sb-clone"));
        let sb_step = r.steps.iter().find(|s| s.id == "sb-clone").unwrap();
        assert_eq!(sb_step.status, StepStatus::Fail);
        assert!(sb_step.remediation.is_some());
    }
}
