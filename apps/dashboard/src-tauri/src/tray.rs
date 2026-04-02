use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};

use crate::widgets::{self, WidgetRegistry};

const STATS_ID: &str = "toggle-stats";
const SHOW_ID: &str = "show-app";
const QUIT_ID: &str = "quit";

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let toggle_stats = CheckMenuItem::with_id(app, STATS_ID, "Quick Stats", true, false, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let show_app = MenuItem::with_id(app, SHOW_ID, "Show CogniStore", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ID, "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&toggle_stats, &separator, &show_app, &quit])?;

    let _tray = TrayIconBuilder::new()
        .icon(Image::from_path("icons/32x32.png").unwrap_or_else(|_| {
            // Fallback: use resource dir icon
            Image::from_bytes(include_bytes!("../icons/32x32.png"))
                .expect("Failed to load tray icon")
        }))
        .menu(&menu)
        .tooltip("CogniStore")
        .on_menu_event(move |app, event| {
            let id = event.id().as_ref();
            match id {
                x if x == STATS_ID => {
                    let is_open = app
                        .state::<WidgetRegistry>()
                        .open
                        .lock()
                        .map(|s| s.contains("stats"))
                        .unwrap_or(false);

                    if is_open {
                        let _ = widgets::close_widget(app.clone(), "stats".into());
                        let _ = toggle_stats.set_checked(false);
                    } else {
                        let _ = widgets::open_widget(app.clone(), "stats".into());
                        let _ = toggle_stats.set_checked(true);
                    }
                }
                x if x == SHOW_ID => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                x if x == QUIT_ID => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(())
}
