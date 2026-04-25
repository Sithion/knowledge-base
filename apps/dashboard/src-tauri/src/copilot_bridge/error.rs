//! Errors surfaced by the Copilot CLI bridge.

use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("invalid path: {0}")]
    InvalidPath(PathBuf),

    #[error("failed to create directory {path}: {source}")]
    Mkdir {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("failed to spawn copilot: {0}")]
    Spawn(#[source] std::io::Error),

    #[error("session id {0} not found")]
    UnknownSession(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<BridgeError> for String {
    fn from(value: BridgeError) -> Self {
        value.to_string()
    }
}
