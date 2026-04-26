//! Process registry — Tauri-managed state mapping sessionId → child handle.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

use super::spawn::ChildHandle;

/// Tauri-managed state. Cheap to clone; the inner map is shared.
#[derive(Clone, Default)]
pub struct CopilotRegistry {
    inner: Arc<Mutex<HashMap<String, ChildHandle>>>,
}

impl CopilotRegistry {
    pub async fn insert(&self, handle: ChildHandle) {
        let mut g = self.inner.lock().await;
        g.insert(handle.session_id.clone(), handle);
    }

    pub async fn remove(&self, session_id: &str) -> Option<ChildHandle> {
        let mut g = self.inner.lock().await;
        g.remove(session_id)
    }

    pub async fn get(&self, session_id: &str) -> Option<ChildHandle> {
        let g = self.inner.lock().await;
        g.get(session_id).cloned()
    }

    pub async fn list_session_ids(&self) -> Vec<String> {
        let g = self.inner.lock().await;
        g.keys().cloned().collect()
    }
}
