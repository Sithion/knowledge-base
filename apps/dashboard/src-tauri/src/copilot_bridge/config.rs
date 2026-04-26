//! Configuration types for the Copilot CLI bridge.
//!
//! These structs deserialize from the Tauri frontend or from disk-backed
//! config (Wave 5 will own the persistence layer). The defaults match the
//! intake-pipeline spec (`gpt-5.4` for intake, `gpt-5.4-mini` for PR-cut,
//! 600s and 120s timeouts respectively).

use serde::{Deserialize, Serialize};

fn default_intake_model() -> String {
    "gpt-5.4".to_string()
}

fn default_pr_cut_model() -> String {
    "gpt-5.4-mini".to_string()
}

fn default_intake_timeout_seconds() -> u64 {
    600
}

fn default_pr_cut_timeout_seconds() -> u64 {
    120
}

/// Subset of `intakePipeline.*` config that the Rust bridge consumes.
///
/// The TS-side schema may carry additional fields (workspace dir, repo
/// URL, base branch, etc.) — those are owned by Wave 5. This struct only
/// captures the values needed when actually spawning `copilot`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotConfig {
    #[serde(default = "default_intake_model")]
    pub intake_model: String,

    #[serde(default = "default_pr_cut_model")]
    pub pr_cut_model: String,

    #[serde(default = "default_intake_timeout_seconds")]
    pub intake_timeout_seconds: u64,

    #[serde(default = "default_pr_cut_timeout_seconds")]
    pub pr_cut_timeout_seconds: u64,
}

impl Default for CopilotConfig {
    fn default() -> Self {
        Self {
            intake_model: default_intake_model(),
            pr_cut_model: default_pr_cut_model(),
            intake_timeout_seconds: default_intake_timeout_seconds(),
            pr_cut_timeout_seconds: default_pr_cut_timeout_seconds(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_spec() {
        let c = CopilotConfig::default();
        assert_eq!(c.intake_model, "gpt-5.4");
        assert_eq!(c.pr_cut_model, "gpt-5.4-mini");
        assert_eq!(c.intake_timeout_seconds, 600);
        assert_eq!(c.pr_cut_timeout_seconds, 120);
    }

    #[test]
    fn deserialize_empty_object_uses_defaults() {
        let c: CopilotConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(c.intake_model, "gpt-5.4");
        assert_eq!(c.pr_cut_timeout_seconds, 120);
    }

    #[test]
    fn deserialize_partial_camel_case() {
        let json = r#"{"intakeModel":"claude-opus-4.6","intakeTimeoutSeconds":900}"#;
        let c: CopilotConfig = serde_json::from_str(json).unwrap();
        assert_eq!(c.intake_model, "claude-opus-4.6");
        assert_eq!(c.intake_timeout_seconds, 900);
        // unspecified fall back to defaults
        assert_eq!(c.pr_cut_model, "gpt-5.4-mini");
        assert_eq!(c.pr_cut_timeout_seconds, 120);
    }
}
