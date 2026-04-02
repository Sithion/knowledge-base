use std::collections::HashSet;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Stores the sidecar port so widget windows can connect to the same server.
pub struct PortState {
    pub port: u16,
}

/// Tracks which widget windows are currently open.
pub struct WidgetRegistry {
    pub open: Mutex<HashSet<String>>,
}

impl Default for WidgetRegistry {
    fn default() -> Self {
        Self {
            open: Mutex::new(HashSet::new()),
        }
    }
}

impl WidgetRegistry {
    pub fn remove(&self, id: &str) {
        if let Ok(mut set) = self.open.lock() {
            set.remove(id);
        }
    }
}

/// Widget definitions: (width, height) per widget type.
fn widget_size(widget_id: &str) -> (f64, f64) {
    match widget_id {
        "stats" => (300.0, 240.0),
        _ => (300.0, 220.0),
    }
}

#[tauri::command]
pub fn open_widget(app: AppHandle, widget_id: String) -> Result<(), String> {
    let label = format!("widget-{}", widget_id);

    // If already open, focus it
    if let Some(win) = app.get_webview_window(&label) {
        win.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let port = app
        .state::<PortState>()
        .port;

    let url = format!("http://localhost:{}/widgets/{}.html", port, widget_id);
    let (w, h) = widget_size(&widget_id);

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url.parse().unwrap()))
        .title("")
        .inner_size(w, h)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .center()
        .build()
        .map_err(|e| format!("Failed to create widget window: {}", e))?;

    if let Ok(mut set) = app.state::<WidgetRegistry>().open.lock() {
        set.insert(widget_id);
    }

    Ok(())
}

#[tauri::command]
pub fn close_widget(app: AppHandle, widget_id: String) -> Result<(), String> {
    let label = format!("widget-{}", widget_id);
    if let Some(win) = app.get_webview_window(&label) {
        win.close().map_err(|e| e.to_string())?;
    }
    app.state::<WidgetRegistry>().remove(&widget_id);
    Ok(())
}

#[tauri::command]
pub fn get_open_widgets(app: AppHandle) -> Vec<String> {
    app.state::<WidgetRegistry>()
        .open
        .lock()
        .map(|set| set.iter().cloned().collect())
        .unwrap_or_default()
}
