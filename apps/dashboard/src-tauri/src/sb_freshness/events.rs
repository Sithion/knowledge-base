//! Typed events emitted by the freshness service.
//!
//! Mirrors the spec's two trigger points (launch + before-use) and the three
//! lifecycle stages (check → pull → import). The frontend listens on the
//! `sb-freshness-event` Tauri event and dispatches by `kind`.

use serde::{Deserialize, Serialize};

/// Categorised failure kinds — mapped from underlying errors to keep UI
/// remediation copy in sync with the Rust source.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FreshnessFailureKind {
    /// `enableSbOrchestration` is `false`. Not a true failure — surfaced so
    /// the dashboard can render a "disabled" state.
    Disabled,
    /// `aiStack.secondBrainPath` is missing or empty.
    NotConfigured,
    /// Configured path does not exist on disk (or is missing `.git`).
    /// Wave-5 (clone-on-first-use) is responsible for fixing this.
    NotInitialized,
    /// `git fetch` / `git pull` / `git rev-list` failed.
    GitFailure,
    /// `cognistore-sync.js` exited non-zero, or could not be located.
    SyncScriptFailure,
    /// Anything else.
    Other,
}

/// Lifecycle event for the freshness pipeline. Wraps a `kind` discriminator
/// so the JS side can `switch` cleanly. All variants carry an ISO-8601
/// timestamp so the UI can sort / display "last activity".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FreshnessEvent {
    /// `check_freshness()` started.
    CheckStarted { ts: String },
    /// `check_freshness()` finished successfully.
    CheckComplete {
        ts: String,
        local_sha: String,
        remote_sha: String,
        is_behind: bool,
        commits_behind: u32,
    },
    /// `pull_latest()` started.
    PullStarted { ts: String },
    /// `pull_latest()` finished, returning the new HEAD sha.
    PullComplete {
        ts: String,
        new_sha: String,
        commits_pulled: u32,
    },
    /// Sync script execution started.
    ImportStarted { ts: String, script_path: String },
    /// Sync script execution finished.
    ImportComplete {
        ts: String,
        exit_code: i32,
        stdout_tail: String,
        stderr_tail: String,
    },
    /// Anything went wrong, anywhere in the pipeline.
    Failed {
        ts: String,
        kind: FreshnessFailureKind,
        message: String,
    },
}

impl FreshnessEvent {
    /// Convenience for the launch task: produce a `Failed` event with the
    /// current timestamp.
    pub fn failed(kind: FreshnessFailureKind, message: impl Into<String>) -> Self {
        Self::Failed {
            ts: now_iso(),
            kind,
            message: message.into(),
        }
    }
}

/// ISO-8601 UTC timestamp without sub-second precision. Avoids pulling in
/// `chrono` for one call site.
pub fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Convert to a naive `YYYY-MM-DDTHH:MM:SSZ` without a calendar lib.
    // Adapted from a well-known epoch-to-iso conversion.
    let (year, month, day, hh, mm, ss) = epoch_to_ymdhms(secs);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hh, mm, ss
    )
}

fn epoch_to_ymdhms(secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let days = (secs / 86_400) as i64;
    let rem = (secs % 86_400) as u32;
    let hh = rem / 3600;
    let mm = (rem % 3600) / 60;
    let ss = rem % 60;

    // Howard Hinnant's date algorithm (civil_from_days).
    let z = days + 719_468;
    let era = if z >= 0 { z / 146_097 } else { (z - 146_096) / 146_097 };
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = (y + if m <= 2 { 1 } else { 0 }) as i32;
    (year, m as u32, d as u32, hh, mm, ss)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_format_round_shape() {
        let s = now_iso();
        // `YYYY-MM-DDTHH:MM:SSZ` is exactly 20 characters.
        assert_eq!(s.len(), 20, "got: {}", s);
        assert!(s.ends_with('Z'));
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[7..8], "-");
        assert_eq!(&s[10..11], "T");
        assert_eq!(&s[13..14], ":");
        assert_eq!(&s[16..17], ":");
    }

    #[test]
    fn failed_helper_sets_kind() {
        let e = FreshnessEvent::failed(FreshnessFailureKind::Disabled, "off");
        match e {
            FreshnessEvent::Failed { kind, message, .. } => {
                assert_eq!(kind, FreshnessFailureKind::Disabled);
                assert_eq!(message, "off");
            }
            _ => panic!("expected Failed"),
        }
    }

    #[test]
    fn event_kind_serializes_snake_case() {
        let e = FreshnessEvent::CheckStarted {
            ts: "2024-01-01T00:00:00Z".into(),
        };
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains(r#""kind":"check_started""#), "got {}", s);
    }

    #[test]
    fn failure_kind_serializes_snake_case() {
        let e = FreshnessEvent::Failed {
            ts: "2024-01-01T00:00:00Z".into(),
            kind: FreshnessFailureKind::NotInitialized,
            message: "no clone".into(),
        };
        let s = serde_json::to_string(&e).unwrap();
        assert!(s.contains(r#""kind":"failed""#));
        assert!(s.contains(r#""kind":"not_initialized""#) || s.contains(r#""not_initialized""#));
    }

    #[test]
    fn epoch_zero_is_unix_epoch() {
        let (y, m, d, hh, mm, ss) = epoch_to_ymdhms(0);
        assert_eq!((y, m, d, hh, mm, ss), (1970, 1, 1, 0, 0, 0));
    }
}
