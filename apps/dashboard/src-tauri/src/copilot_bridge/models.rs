//! Curated model catalog vendored at build time.
//!
//! The JSON file ships at `templates/copilot-models.json` and is embedded
//! via [`include_str!`] so the dashboard never has to read it from disk
//! at runtime. The frontend dropdown for both intake and PR-cut models is
//! populated from this list (plus a free-text "Other (specify)…" fallback
//! handled on the TS side).

use serde::{Deserialize, Serialize};

const CATALOG_JSON: &str = include_str!("../../templates/copilot-models.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelTier {
    Auto,
    Premium,
    Standard,
    Fast,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
    pub tier: ModelTier,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ModelCatalog {
    pub version: String,
    pub models: Vec<ModelInfo>,
}

/// Parse the embedded catalog. Panics on malformed JSON because the file
/// is vendored — a malformed catalog is a build-time bug.
pub fn load_catalog() -> ModelCatalog {
    serde_json::from_str(CATALOG_JSON).expect("vendored copilot-models.json is malformed")
}

/// Just the list of models, for the simplest Tauri command shape.
pub fn list_models() -> Vec<ModelInfo> {
    load_catalog().models
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_catalog_parses() {
        let c = load_catalog();
        assert!(!c.models.is_empty());
        // Spec calls out specific entries — assert a few key ones are present.
        let ids: Vec<&str> = c.models.iter().map(|m| m.id.as_str()).collect();
        for required in ["gpt-5.4", "gpt-5.4-mini", "claude-sonnet-4.6", "claude-haiku-4.5"] {
            assert!(ids.contains(&required), "missing required model {required}");
        }
    }

    #[test]
    fn tiers_are_recognised() {
        let c = load_catalog();
        let mut have_premium = false;
        let mut have_standard = false;
        let mut have_fast = false;
        for m in &c.models {
            match m.tier {
                ModelTier::Premium => have_premium = true,
                ModelTier::Standard => have_standard = true,
                ModelTier::Fast => have_fast = true,
                ModelTier::Auto => {}
            }
        }
        assert!(have_premium && have_standard && have_fast);
    }
}
