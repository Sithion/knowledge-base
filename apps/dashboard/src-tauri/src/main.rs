// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod sidecar;

use sidecar::SidecarState;
use std::time::Duration;
use tauri::Manager;

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

    // 4. Find available port
    let port = sidecar::find_available_port(3210);

    // 5. Spawn sidecar (returns child process + identity token)
    let (child, token) = sidecar::spawn_node(
        &node_bin,
        &script_path,
        &resource_dir,
        &sqlite_path,
        port,
    )?;

    app.manage(SidecarState::new(child));

    // 6. Wait for OUR server to be ready (verifies sidecar token), then navigate WebView
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    tauri::async_runtime::spawn(async move {
        let ready = sidecar::wait_for_ready(port, &token, Duration::from_secs(30)).await;
        if ready {
            let url = format!("http://localhost:{}", port);
            let _ = window.navigate(url.parse().unwrap());
        } else {
            let _ = window.eval(&format!(
                "document.body.innerHTML = '<div style=\"display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;font-family:sans-serif;color:#ef4444;background:#0a0a1a;padding:32px;text-align:center\"><h2>Failed to start server</h2><p>The server did not respond within 30 seconds on port {}.</p><p style=\"color:#fca5a5\">Try restarting the app. If the issue persists, check that Node.js v20 is installed.</p></div>'",
                port
            ));
        }
    });

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if let Err(msg) = run_setup(app) {
                eprintln!("Setup error: {}", msg);
                // Show error in the webview instead of returning Err,
                // which would panic through the FFI boundary (did_finish_launching).
                if let Some(window) = app.get_webview_window("main") {
                    let escaped = msg.replace('\\', "\\\\").replace('\'', "\\'");
                    let _ = window.eval(&format!(
                        "document.body.innerHTML = '<div style=\"display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;font-family:sans-serif;color:#ef4444;background:#0a0a1a;padding:32px;text-align:center\"><h2>CogniStore failed to start</h2><p style=\"color:#fca5a5\">{}</p></div>'",
                        escaped
                    ));
                }
            }
            Ok(()) // Always succeed — never panic through FFI
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<SidecarState>() {
                    state.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Error while running CogniStore");
}
