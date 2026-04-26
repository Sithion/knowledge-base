//! Cross-platform process group lifecycle helpers.
//!
//! On Unix-like targets (macOS / Linux) the child becomes its own
//! session leader via `setsid()` so we can deliver signals to the entire
//! process tree via `killpg`. On Linux we additionally request
//! `PR_SET_PDEATHSIG = SIGKILL` so the child is reaped if CogniStore
//! itself crashes.
//!
//! On Windows the child is created with `CREATE_NEW_PROCESS_GROUP` and
//! attached to a Job Object; aborting calls `TerminateJobObject` which
//! kills the entire descendant tree.
//!
//! All Windows code lives behind `#[cfg(windows)]` and is not built or
//! tested on macOS/Linux.

#![allow(dead_code)] // Some helpers used only on a single target.

use tokio::process::Command;

/// Configure a `tokio::process::Command` so that the spawned child is
/// the leader of a fresh process group / session. On Unix this calls
/// `setsid()` in the child via `pre_exec`, on Linux it additionally
/// arms `PR_SET_PDEATHSIG`. On Windows it sets `CREATE_NEW_PROCESS_GROUP`.
pub fn configure_new_process_group(cmd: &mut Command) {
    #[cfg(unix)]
    unix::configure(cmd);

    #[cfg(windows)]
    windows::configure(cmd);

    // Suppress unused-var warning on platforms where neither cfg matches.
    #[cfg(not(any(unix, windows)))]
    {
        let _ = cmd;
    }
}

/// OS-specific abort. Sends a graceful signal first; the caller is
/// expected to wait up to 5 seconds and then call [`force_kill_group`]
/// if the child has not exited.
pub fn terminate_group(pid: u32) {
    #[cfg(unix)]
    unix::terminate(pid);

    #[cfg(windows)]
    windows::terminate(pid);

    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
    }
}

/// Hard-kill the process group / job object.
pub fn force_kill_group(pid: u32) {
    #[cfg(unix)]
    unix::force_kill(pid);

    #[cfg(windows)]
    windows::force_kill(pid);

    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
    }
}

// ---------------------------------------------------------------------
// Unix (macOS / Linux)
// ---------------------------------------------------------------------

#[cfg(unix)]
mod unix {
    use std::io;
    use tokio::process::Command;

    pub fn configure(cmd: &mut Command) {
        unsafe {
            cmd.pre_exec(|| {
                // Detach into a new session (and thus a new process group
                // whose PGID == our PID). After this we can target the
                // group with killpg(-pid, sig).
                if libc::setsid() == -1 {
                    return Err(io::Error::last_os_error());
                }

                // Linux only: ask the kernel to SIGKILL us if our parent
                // dies. macOS does not implement prctl/PDEATHSIG; on macOS
                // the supervisor relies on lockfile + PID reconciliation.
                #[cfg(target_os = "linux")]
                {
                    // PR_SET_PDEATHSIG = 1, SIGKILL = 9
                    if libc::prctl(1, 9, 0, 0, 0) == -1 {
                        return Err(io::Error::last_os_error());
                    }
                }

                Ok(())
            });
        }
    }

    /// Send SIGTERM to the whole process group (negative pid).
    pub fn terminate(pid: u32) {
        unsafe {
            // killpg expects the *positive* group id; since we set the
            // group id == child pid via setsid(), pgid == pid here.
            let _ = libc::killpg(pid as libc::pid_t, libc::SIGTERM);
        }
    }

    /// Send SIGKILL to the whole process group.
    pub fn force_kill(pid: u32) {
        unsafe {
            let _ = libc::killpg(pid as libc::pid_t, libc::SIGKILL);
        }
    }
}

// ---------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------

#[cfg(windows)]
mod windows {
    use std::sync::Mutex;
    use tokio::process::Command;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
        TerminateJobObject, JobObjectExtendedLimitInformation,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, CREATE_NEW_PROCESS_GROUP, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// Per-pid Job Object handle so abort can target the right tree.
    /// Held in a process-wide map keyed by child pid.
    static JOBS: Mutex<Option<std::collections::HashMap<u32, isize>>> = Mutex::new(None);

    pub fn configure(cmd: &mut Command) {
        cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
    }

    /// Called by the spawn layer immediately after the child is spawned.
    /// Creates a Job Object configured with KILL_ON_JOB_CLOSE and
    /// assigns the child process to it. Returns false on failure (the
    /// caller should still proceed; we degrade gracefully to per-pid kill).
    pub fn assign_to_job(pid: u32) -> bool {
        unsafe {
            let job: HANDLE = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return false;
            }

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == 0 {
                CloseHandle(job);
                return false;
            }

            let proc_handle = OpenProcess(PROCESS_TERMINATE | PROCESS_SET_QUOTA, 0, pid);
            if proc_handle.is_null() {
                CloseHandle(job);
                return false;
            }

            let assigned = AssignProcessToJobObject(job, proc_handle);
            CloseHandle(proc_handle);
            if assigned == 0 {
                CloseHandle(job);
                return false;
            }

            let mut guard = JOBS.lock().unwrap();
            let map = guard.get_or_insert_with(std::collections::HashMap::new);
            map.insert(pid, job as isize);
            true
        }
    }

    pub fn terminate(pid: u32) {
        // Windows has no SIGTERM equivalent for our purposes; we treat
        // graceful abort as "terminate the job tree". This still gives
        // the 5-second window before force_kill is called.
        terminate_job(pid);
    }

    pub fn force_kill(pid: u32) {
        terminate_job(pid);
    }

    fn terminate_job(pid: u32) {
        let job_handle = {
            let mut guard = JOBS.lock().unwrap();
            guard
                .as_mut()
                .and_then(|m| m.remove(&pid))
                .unwrap_or(0)
        };
        if job_handle != 0 {
            unsafe {
                TerminateJobObject(job_handle as HANDLE, 1);
                CloseHandle(job_handle as HANDLE);
            }
        }
    }
}

#[cfg(windows)]
pub use self::windows::assign_to_job;
