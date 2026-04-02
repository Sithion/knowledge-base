use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Serialize, Deserialize, Clone)]
pub struct WidgetState {
    pub label: String,
    pub widget_type: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Deserialize, Default)]
pub struct WidgetConfig {
    pub widgets: Vec<WidgetState>,
}

/// In-memory position tracker: label -> (x, y). Flushed to disk on close/exit.
pub struct WidgetPositions {
    pub positions: Mutex<HashMap<String, (f64, f64)>>,
    pub last_flush: Mutex<Instant>,
}

impl Default for WidgetPositions {
    fn default() -> Self {
        Self {
            positions: Mutex::new(HashMap::new()),
            last_flush: Mutex::new(Instant::now()),
        }
    }
}

fn config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".cognistore")
        .join("widgets.json")
}

pub fn load_config() -> WidgetConfig {
    let path = config_path();
    if !path.exists() {
        return WidgetConfig::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_config(config: &WidgetConfig) {
    let path = config_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(config) {
        let _ = fs::write(&path, json);
    }
}

/// Get saved position for a widget by label.
pub fn get_widget_position(label: &str) -> Option<(f64, f64)> {
    let config = load_config();
    config
        .widgets
        .iter()
        .find(|w| w.label == label)
        .map(|w| (w.x, w.y))
}
