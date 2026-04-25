//! Copilot CLI bridge: spawn `copilot` subprocesses, parse JSONL transcript
//! events, surface them to the Tauri frontend, and manage cross-platform
//! process-group lifecycle.
//!
//! See `openspec/changes/ai-stack-poc-cognistore-intake-pipeline/specs/copilot-cli-bridge/spec.md`.

pub mod commands;
pub mod config;
pub mod error;
pub mod events;
pub mod models;
pub mod process_group;
pub mod registry;
pub mod spawn;

pub use config::CopilotConfig;
pub use error::BridgeError;
pub use events::{ErrorKind, TranscriptEvent, TranscriptEventPayload};
pub use models::{ModelCatalog, ModelInfo, ModelTier};
pub use registry::CopilotRegistry;
pub use spawn::{spawn_copilot, ChildHandle, CopilotArgs, SessionExitPayload};
