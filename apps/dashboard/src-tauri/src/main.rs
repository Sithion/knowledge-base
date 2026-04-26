// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;
mod tray;
mod widget_config;
mod widgets;
// AI_STACK_POC:COPILOT_BRIDGE_MOD_BEGIN
mod copilot_bridge;
// AI_STACK_POC:COPILOT_BRIDGE_MOD_END
// AI_STACK_POC:FRESHNESS_MOD_BEGIN
mod sb_freshness;
// AI_STACK_POC:FRESHNESS_MOD_END
// AI_STACK_POC:INTAKE_MOD_BEGIN
mod intake;
mod sb_clone;
// AI_STACK_POC:INTAKE_MOD_END

use sidecar::SidecarState;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{Emitter, Manager};
use widget_config::WidgetPositions;
use widgets::{PortState, WidgetRegistry};

/// Generate a user-friendly error page HTML for the webview.
fn error_page_html(title: &str, detail: &str) -> String {
    let escaped_detail = detail
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");

    format!(
        r#"document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:20px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a1a;padding:32px;text-align:center"><div style="font-size:48px">🧠</div><h2 style="color:#e2e8f0;margin:0;font-size:18px">{title}</h2><p style="color:#94a3b8;margin:0;font-size:13px">Something went wrong while starting CogniStore.</p><details style="color:#6b7280;font-size:11px;max-width:500px;text-align:left"><summary style="cursor:pointer;color:#94a3b8;font-size:12px;margin-bottom:8px">Show details</summary><pre style="background:#111827;padding:12px;border-radius:8px;overflow-x:auto;color:#fca5a5;font-size:10px;white-space:pre-wrap;word-break:break-all">{escaped_detail}</pre></details><div style="display:flex;gap:12px"><button onclick="location.reload()" style="padding:8px 20px;border-radius:6px;border:none;background:#6366f1;color:#fff;cursor:pointer;font-size:13px">Retry</button></div></div>';"#,
        title = title,
        escaped_detail = escaped_detail
    )
}

/// Run the full setup logic. Extracted so that errors can be caught
/// and displayed in the webview instead of panicking through FFI.
fn run_setup(app: &mut tauri::App) -> Result<(), String> {
    // 1. Find Node.js
    let node_bin = sidecar::find_node()?;

    // 2. Resolve resource paths
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Cannot resolve resources: {}", e))?;

    let script_path = resource_dir.join("dist-server").join("index.js");

    if !script_path.exists() {
        return Err(format!("Server script not found at: {:?}", script_path));
    }

    // 3. Resolve SQLite path
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve home directory".to_string())?;
    let sqlite_path = home.join(".cognistore").join("knowledge.db");

    // 3b. Compute managed Second Brain workspace dir so the sidecar can
    //     resolve `/api/sb/projects` against the same path the Rust side
    //     clones into. Mirrors the resolution in the .setup() closure.
    let workspace_dir_for_sidecar: Option<PathBuf> = {
        let env_override = std::env::var("COGNISTORE_INTAKE_WORKSPACE_DIR").ok();
        let app_data = app
            .path()
            .app_data_dir()
            .ok()
            .or_else(|| dirs::home_dir().map(|h| h.join(".cognistore")));
        env_override
            .map(|s| {
                if let Some(stripped) = s.strip_prefix("~/") {
                    home.join(stripped)
                } else {
                    PathBuf::from(s)
                }
            })
            .or_else(|| app_data.map(|d| d.join("second-brain-workspace")))
    };

    // 4. Find available port
    sidecar::reap_orphan_sidecars();
    let port = sidecar::find_available_port(3210);

    // 5. Spawn sidecar (returns child process + identity token)
    let (child, token) = sidecar::spawn_node(
        &node_bin,
        &script_path,
        &resource_dir,
        &sqlite_path,
        port,
        workspace_dir_for_sidecar.as_ref(),
    )?;

    app.manage(SidecarState::new(child));
    app.manage(PortState { port });
    app.manage(WidgetRegistry::default());
    app.manage(WidgetPositions::default());

    // 6. Set up system tray
    tray::setup_tray(app.handle()).map_err(|e| format!("Tray setup failed: {}", e))?;

    // 7. Wait for OUR server to be ready (verifies sidecar token), then navigate WebView
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    let app_handle_for_restore = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let ready = sidecar::wait_for_ready(port, &token, Duration::from_secs(30)).await;
        if ready {
            let url = format!("http://localhost:{}", port);
            let _ = window.navigate(url.parse().unwrap());

            // Restore saved widgets after sidecar is ready
            let config = widget_config::load_config();
            for ws in &config.widgets {
                if let Ok(new_label) = widgets::open_widget(app_handle_for_restore.clone(), ws.widget_type.clone(), None) {
                    // Set position for the new instance and move the window
                    if let Some(positions) = app_handle_for_restore.try_state::<WidgetPositions>() {
                        if let Ok(mut pos) = positions.positions.lock() {
                            pos.insert(new_label.clone(), (ws.x, ws.y));
                        }
                    }
                    if let Some(win) = app_handle_for_restore.get_webview_window(&new_label) {
                        let _ = win.set_position(tauri::Position::Physical(
                            tauri::PhysicalPosition::new(ws.x as i32, ws.y as i32),
                        ));
                    }
                }
            }
        } else {
            let detail = format!("The server did not respond within 30 seconds on port {}. Ensure Node.js v20 is installed.", port);
            let _ = window.eval(&error_page_html("Failed to start server", &detail));
        }
    });

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            widgets::open_widget,
            widgets::close_widget,
            widgets::get_open_widgets,
            // AI_STACK_POC:COPILOT_BRIDGE_HANDLERS_BEGIN
            copilot_bridge::commands::get_copilot_models,
            copilot_bridge::commands::spawn_copilot_session,
            copilot_bridge::commands::abort_copilot_session,
            // AI_STACK_POC:COPILOT_BRIDGE_HANDLERS_END
            // AI_STACK_POC:FRESHNESS_HANDLERS_BEGIN
            sb_freshness::commands::sb_freshness_check,
            sb_freshness::commands::sb_freshness_pull_and_import,
            sb_freshness::commands::sb_freshness_status,
            // AI_STACK_POC:FRESHNESS_HANDLERS_END
            // AI_STACK_POC:INTAKE_HANDLERS_BEGIN
            sb_clone::commands::sb_clone_ensure,
            sb_clone::commands::sb_clone_status,
            sb_clone::commands::sb_clone_cleanup,
            sb_clone::commands::sb_clone_save_remote_url,
            intake::commands::run_intake,
            intake::commands::run_pr_cut,
            intake::commands::intake_first_run_setup,
            intake::commands::intake_list_audit_records,
            intake::commands::intake_get_audit_record,
            intake::commands::intake_lock_state,
            intake::commands::git_diff_intake_branch,
            intake::commands::cancel_intake_run,
            intake::commands::context_engine_reindex,
            intake::commands::context_engine_repo_status,
            // AI_STACK_POC:INTAKE_HANDLERS_END
        ])
        .setup(|app| {
            // AI_STACK_POC:COPILOT_BRIDGE_STATE_BEGIN
            app.manage(copilot_bridge::registry::CopilotRegistry::default());
            // AI_STACK_POC:COPILOT_BRIDGE_STATE_END
            // AI_STACK_POC:FRESHNESS_STATE_BEGIN
            // Resolve config from env (the dashboard server uses the same
            // env-var fallback pattern). When the SDK persists config to a
            // file we'll read it here too — for now env wins.
            let sb_path_env = std::env::var("COGNISTORE_SECOND_BRAIN_PATH").ok();
            let enabled_env = std::env::var("COGNISTORE_ENABLE_SB_ORCHESTRATION")
                .ok()
                .map(|v| {
                    let v = v.trim().to_ascii_lowercase();
                    matches!(v.as_str(), "1" | "true" | "yes" | "on")
                })
                .unwrap_or(false);
            // Also honor the migration-banner choice persisted at
            // ~/.cognistore/.ai-stack-poc-migration.json — if the user
            // accepted in the dashboard banner, surface enable here too
            // so freshness/clone managers reflect that choice on next launch.
            let enabled_from_migration = dirs::home_dir()
                .map(|h| h.join(".cognistore").join(".ai-stack-poc-migration.json"))
                .and_then(|p| std::fs::read_to_string(&p).ok())
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("response").and_then(|r| r.as_str().map(String::from)))
                .map(|r| r == "enabled")
                .unwrap_or(false);
            let enabled_env = enabled_env || enabled_from_migration;

            // Compute the managed-clone workspace path early so the freshness
            // service can default to it (single source of truth for "where is
            // the Second Brain on disk"). The managed clone is CogniStore's
            // own, NEVER a personal checkout the user may have elsewhere.
            let workspace_dir_env = std::env::var("COGNISTORE_INTAKE_WORKSPACE_DIR").ok();
            let app_data_dir = app
                .path()
                .app_data_dir()
                .ok()
                .or_else(|| dirs::home_dir().map(|h| h.join(".cognistore")))
                .unwrap_or_else(|| std::path::PathBuf::from("."));
            let workspace_dir = workspace_dir_env
                .clone()
                .map(|s| {
                    if let Some(rest) = s.strip_prefix("~/") {
                        dirs::home_dir().map(|h| h.join(rest)).unwrap_or_else(|| s.into())
                    } else {
                        std::path::PathBuf::from(s)
                    }
                })
                .unwrap_or_else(|| app_data_dir.join("second-brain-workspace"));

            let sb_path = sb_path_env
                .as_ref()
                .map(|s| {
                    if let Some(rest) = s.strip_prefix("~/") {
                        dirs::home_dir().map(|h| h.join(rest)).unwrap_or_else(|| s.into())
                    } else {
                        s.into()
                    }
                })
                .unwrap_or_else(|| workspace_dir.clone());
            let freshness_cfg = sb_freshness::service::FreshnessConfig {
                second_brain_path: Some(sb_path),
                enable_sb_orchestration: enabled_env,
                branch: std::env::var("COGNISTORE_SB_BRANCH")
                    .unwrap_or_else(|_| "develop".to_string()),
                sync_script: None,
            };
            let freshness = sb_freshness::SbFreshnessService::new(freshness_cfg);
            app.manage(freshness.clone());
            let freshness_for_intake = freshness.clone();

            // Launch-time freshness check: spawn detached. Skips silently
            // when the gate is off (Failed{Disabled} event), so this is a
            // no-op for users who haven't opted in.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let events = freshness.check_freshness().await;
                for ev in &events {
                    let _ = app_handle.emit(
                        sb_freshness::commands::FRESHNESS_EVENT_TOPIC,
                        ev,
                    );
                }
            });
            // AI_STACK_POC:FRESHNESS_STATE_END
            // AI_STACK_POC:INTAKE_STATE_BEGIN
            // Intake-pipeline state: managed clone manager + intake service.
            // Both no-op when `enableSbOrchestration` is false (the gate is
            // already enforced by the freshness service above; we mirror it
            // here for the parallel managed-clone surface).
            // workspace_dir + app_data_dir already computed above; reuse them.
            // Resolve remote URL: env var first, then a small persistent
            // config file the user populates from the first-run wizard.
            // We intentionally do NOT auto-discover from personal clones —
            // the managed clone is CogniStore's own, separate from any
            // personal Second Brain checkout the user may already have.
            let remote_url_env = std::env::var("COGNISTORE_SECOND_BRAIN_REMOTE")
                .ok()
                .filter(|s| !s.trim().is_empty());
            let remote_url = remote_url_env.or_else(|| {
                dirs::home_dir()
                    .map(|h| h.join(".cognistore").join("sb-remote-url.txt"))
                    .and_then(|p| std::fs::read_to_string(&p).ok())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
            });

            let clone_cfg = sb_clone::CloneConfig {
                enable_sb_orchestration: enabled_env,
                workspace_dir: workspace_dir.clone(),
                remote_url,
                default_branch: std::env::var("COGNISTORE_SB_BRANCH")
                    .unwrap_or_else(|_| "develop".to_string()),
            };
            let clone_manager = sb_clone::ManagedCloneManager::new(clone_cfg);
            app.manage(clone_manager.clone());

            let intake_model = std::env::var("COGNISTORE_INTAKE_MODEL")
                .unwrap_or_else(|_| "auto".to_string());
            let pr_cut_model = std::env::var("COGNISTORE_PR_CUT_MODEL")
                .unwrap_or_else(|_| "auto".to_string());
            let intake_timeout_secs = std::env::var("COGNISTORE_INTAKE_TIMEOUT_SECONDS")
                .ok()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(1800);
            let pr_cut_timeout_secs = std::env::var("COGNISTORE_PR_CUT_TIMEOUT_SECONDS")
                .ok()
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(600);
            let pr_cut_base_branch = std::env::var("COGNISTORE_PR_CUT_BASE_BRANCH")
                .unwrap_or_else(|_| "develop".to_string());

            let intake_cfg = intake::IntakePipelineConfig {
                enable_sb_orchestration: enabled_env,
                managed_clone_path: workspace_dir.clone(),
                intake_model,
                pr_cut_model,
                intake_timeout_secs,
                pr_cut_timeout_secs,
                pr_cut_base_branch,
                audit_root: app_data_dir.clone(),
                intake_prompt_template: std::env::var("COGNISTORE_INTAKE_PROMPT_PATH")
                    .ok()
                    .map(std::path::PathBuf::from),
                pr_cut_prompt_template: std::env::var("COGNISTORE_PR_CUT_PROMPT_PATH")
                    .ok()
                    .map(std::path::PathBuf::from),
            };
            let intake_service =
                intake::IntakeService::new(intake_cfg, clone_manager.clone(), freshness_for_intake);
            app.manage(intake_service);
            // AI_STACK_POC:INTAKE_STATE_END
            if let Err(msg) = run_setup(app) {
                eprintln!("Setup error: {}", msg);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval(&error_page_html("CogniStore failed to start", &msg));
                }
            }
            Ok(()) // Always succeed — never panic through FFI
        })
        .on_window_event(|window, event| {
            let label = window.label().to_string();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if label == "main" {
                        // Hide main window instead of closing — reopen via dock/tray
                        api.prevent_close();
                        let _ = window.hide();
                    } else if label.starts_with("widget-") {
                        // User explicitly closed a widget — remove from positions and save to disk
                        if let Some(positions) = window.try_state::<WidgetPositions>() {
                            if let Ok(mut pos) = positions.positions.lock() {
                                pos.remove(&label);
                            }
                        }
                        // Flush remaining positions to disk immediately
                        widgets::flush_widget_config(window.app_handle());
                    }
                }
                tauri::WindowEvent::Moved(position) => {
                    if label.starts_with("widget-") {
                        if let Some(positions) = window.try_state::<WidgetPositions>() {
                            if let Ok(mut pos) = positions.positions.lock() {
                                pos.insert(label.clone(), (position.x as f64, position.y as f64));
                            }
                        }
                        // Flush to disk (debounced — at most once per 500ms during drag)
                        widgets::flush_widget_config_debounced(window.app_handle(), false);
                    }
                }
                tauri::WindowEvent::Destroyed => {
                    if label == "main" {
                        if let Some(state) = window.try_state::<SidecarState>() {
                            state.kill();
                        }
                    } else if label.starts_with("widget-") {
                        if let Some(registry) = window.try_state::<WidgetRegistry>() {
                            registry.remove(&label);
                        }
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("Error while building CogniStore")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                // Keep running in background when main window is hidden
                api.prevent_exit();
            }
            if let tauri::RunEvent::Exit = &event {
                // App is actually terminating — kill the sidecar so its
                // port isn't held by an orphaned Node process the next
                // time the app launches.
                if let Some(state) = app.try_state::<SidecarState>() {
                    state.kill();
                }
            }
        });
}
