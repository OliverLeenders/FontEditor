use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Manager, WindowEvent};

/// Whether the window has asked the page about closing and not heard back.
///
/// The page decides whether closing needs a question — only it knows whether
/// the font has changes its folder does not — so a close request is held here
/// and handed over. If the page never answers, because it failed to load or is
/// stuck, a second press of the close button closes the window: a question the
/// program cannot ask must not become a window that cannot be shut.
static ASKING: AtomicBool = AtomicBool::new(false);

/// Close the window for real, without asking again.
///
/// `destroy` rather than `close`: `close` raises another close request, which
/// would come straight back here.
#[tauri::command]
fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
  window.destroy().map_err(|error| error.to_string())
}

/// The page asked, and the answer was to stay open.
#[tauri::command]
fn keep_window_open() {
  ASKING.store(false, Ordering::SeqCst);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![close_window, keep_window_open])
    .on_window_event(|window, event| {
      let WindowEvent::CloseRequested { api, .. } = event else {
        return;
      };

      // Already asked and no answer: this is the second press, so let it close.
      if ASKING.swap(true, Ordering::SeqCst) {
        return;
      }

      let asked = window
        .get_webview_window(window.label())
        .map(|webview| {
          webview
            .eval("window.dispatchEvent(new Event('typewright:close-requested'))")
            .is_ok()
        })
        .unwrap_or(false);

      if asked {
        api.prevent_close();
      } else {
        // Nothing to ask; close as the button said.
        ASKING.store(false, Ordering::SeqCst);
      }
    })
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
