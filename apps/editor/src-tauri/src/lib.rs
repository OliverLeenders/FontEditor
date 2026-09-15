use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, WindowEvent};
use tauri_plugin_updater::UpdaterExt;

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

/// The version of a newer release, if one has been published.
///
/// Asked once, when the page starts, of the manifest the release workflow
/// attaches to the latest published GitHub release. Always `None` in a debug
/// build, which is somebody's work in progress rather than an installed copy,
/// and would otherwise offer to replace itself with the last release.
#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<Option<String>, String> {
  if cfg!(debug_assertions) {
    return Ok(None);
  }
  let update = app
    .updater()
    .map_err(|error| error.to_string())?
    .check()
    .await
    .map_err(|error| error.to_string())?;
  Ok(update.map(|update| update.version))
}

/// Download the newer release, install it, and start it.
///
/// It checks again rather than keeping what `check_for_update` found, so there
/// is no state here to go stale while the offer sits unanswered. The download
/// is refused unless its signature matches the public key in the configuration.
/// On Windows the installer takes over and ends this process itself; elsewhere
/// the application restarts once the new one is in place.
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
  let update = app
    .updater()
    .map_err(|error| error.to_string())?
    .check()
    .await
    .map_err(|error| error.to_string())?
    .ok_or_else(|| "there is no newer version to install".to_string())?;
  update
    .download_and_install(|_, _| {}, || {})
    .await
    .map_err(|error| error.to_string())?;
  app.restart();
}

/// Hint a TrueType font with ttfautohint, and hand back the hinted font.
///
/// The page compiles the font and sends its bytes as they are; this runs the
/// ttfautohint bundled beside the application, with its defaults, and answers
/// with what it wrote. Only the desktop application can do this — a browser has
/// no program to run — which is why the browser's export has no hinted TrueType.
///
/// On the blocking pool, because ttfautohint takes a moment on a large font and
/// the window should not stop drawing while it does.
#[tauri::command]
async fn hint_truetype(request: Request<'_>) -> Result<Response, String> {
  let InvokeBody::Raw(font) = request.body() else {
    return Err("the font was not sent as bytes".into());
  };
  let font = font.clone();
  let hinted = tauri::async_runtime::spawn_blocking(move || autohint(&font))
    .await
    .map_err(|error| error.to_string())??;
  Ok(Response::new(hinted))
}

/// Run ttfautohint on a font, through a pair of temporary files.
///
/// Files rather than its standard input and output, which it also reads and
/// writes: on Windows a program's standard streams are text unless it says
/// otherwise, and a font is not text.
fn autohint(font: &[u8]) -> Result<Vec<u8>, String> {
  let program = bundled("ttfautohint")?;

  let stamp = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|since| since.as_nanos())
    .unwrap_or(0);
  let scratch = std::env::temp_dir();
  let input = scratch.join(format!("typewright-{}-{stamp}.ttf", std::process::id()));
  let output = scratch.join(format!("typewright-{}-{stamp}-hinted.ttf", std::process::id()));

  std::fs::write(&input, font).map_err(|error| format!("the font could not be written out: {error}"))?;

  let mut command = Command::new(&program);
  command.arg(&input).arg(&output);
  // No console window flashing up behind the application on Windows.
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
  }

  let result = command.output();
  let hinted = std::fs::read(&output);
  let _ = std::fs::remove_file(&input);
  let _ = std::fs::remove_file(&output);

  let ran = result
    .map_err(|error| format!("ttfautohint could not be started from {}: {error}", program.display()))?;
  if !ran.status.success() {
    return Err(format!(
      "ttfautohint could not hint this font: {}",
      String::from_utf8_lossy(&ran.stderr).trim()
    ));
  }
  hinted.map_err(|error| format!("ttfautohint wrote nothing readable: {error}"))
}

/// A program bundled with the application, which Tauri puts beside its executable.
fn bundled(name: &str) -> Result<PathBuf, String> {
  let executable = std::env::current_exe().map_err(|error| error.to_string())?;
  let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
  let path = executable.with_file_name(file);
  if path.exists() {
    Ok(path)
  } else {
    Err(format!("{name} is not installed beside the application at {}", path.display()))
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .invoke_handler(tauri::generate_handler![
      close_window,
      keep_window_open,
      check_for_update,
      install_update,
      hint_truetype
    ])
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
