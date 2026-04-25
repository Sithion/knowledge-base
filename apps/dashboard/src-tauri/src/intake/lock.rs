//! OS-level single-instance lock for the managed clone.
//!
//! Uses `fs2::FileExt::try_lock_exclusive` (`flock` on Unix, `LockFileEx`
//! on Windows). The lock file lives at `${managedClone}/.cognistore-intake.lock`
//! and is released on process exit by OS reclamation — explicit unlock is
//! the happy-path; OS-level cleanup handles crashes.
//!
//! Acquire semantics match the spec: a 2-second budget with brief polling.
//! On failure we return a structured `LockError::Busy` that the UI maps
//! to the "Another CogniStore instance is using the managed clone." banner.

use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use fs2::FileExt;
use thiserror::Error;

const ACQUIRE_BUDGET: Duration = Duration::from_secs(2);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Error)]
pub enum LockError {
    #[error("lock file dir does not exist: {0}")]
    NoDir(PathBuf),
    #[error("failed to open lock file {path}: {source}")]
    Open {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("another CogniStore instance is using the managed clone")]
    Busy,
}

/// RAII guard. Drop unlocks the file (best-effort) and removes the
/// handle. The file itself is left on disk so subsequent runs can
/// re-acquire it without stat'ing.
pub struct IntakeLock {
    file: File,
    path: PathBuf,
}

impl IntakeLock {
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Try to acquire the lock. Returns `Ok` on success, `Err(Busy)` after
    /// `ACQUIRE_BUDGET` if another holder remains.
    pub fn acquire(managed_clone: &Path) -> Result<Self, LockError> {
        if !managed_clone.is_dir() {
            return Err(LockError::NoDir(managed_clone.to_path_buf()));
        }
        let path = managed_clone.join(".cognistore-intake.lock");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)
            .map_err(|e| LockError::Open {
                path: path.clone(),
                source: e,
            })?;

        let deadline = Instant::now() + ACQUIRE_BUDGET;
        loop {
            match file.try_lock_exclusive() {
                Ok(()) => return Ok(Self { file, path }),
                Err(_) => {
                    if Instant::now() >= deadline {
                        return Err(LockError::Busy);
                    }
                    std::thread::sleep(POLL_INTERVAL);
                }
            }
        }
    }
}

impl Drop for IntakeLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_tmp(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "cognistore-lock-test-{}-{}-{}",
            label,
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)
        ))
    }

    #[test]
    fn acquire_creates_file_in_dir() {
        let dir = unique_tmp("create-file");
        std::fs::create_dir_all(&dir).unwrap();
        let lock = IntakeLock::acquire(&dir).unwrap();
        assert!(lock.path().exists());
        drop(lock);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn second_acquire_is_busy() {
        let dir = unique_tmp("busy");
        std::fs::create_dir_all(&dir).unwrap();
        let _first = IntakeLock::acquire(&dir).unwrap();
        let r = IntakeLock::acquire(&dir);
        assert!(matches!(r, Err(LockError::Busy)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn release_allows_reacquire() {
        let dir = unique_tmp("release");
        std::fs::create_dir_all(&dir).unwrap();
        {
            let _g = IntakeLock::acquire(&dir).unwrap();
        } // drop releases
        let again = IntakeLock::acquire(&dir);
        assert!(again.is_ok());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_dir_yields_no_dir_err() {
        let dir = unique_tmp("nodir");
        let r = IntakeLock::acquire(&dir);
        assert!(matches!(r, Err(LockError::NoDir(_))));
    }
}
