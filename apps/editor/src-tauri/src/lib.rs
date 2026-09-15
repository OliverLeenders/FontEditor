use std::collections::HashSet;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_updater::UpdaterExt;

/// The windows that have asked their page about closing and not heard back, by label.
///
/// The page decides whether closing needs a question — only it knows whether
/// the font has changes its folder does not — so a close request is held here
/// and handed over. If the page never answers, because it failed to load or is
/// stuck, a second press of the close button closes the window: a question the
/// program cannot ask must not become a window that cannot be shut. Kept per
/// window, because each window is on a font of its own and asks about its own
/// folder.
fn asking() -> &'static Mutex<HashSet<String>> {
  static ASKING: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
  ASKING.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Forget that a window was asking, whether it closed or stayed.
fn stop_asking(label: &str) {
  if let Ok(mut asking) = asking().lock() {
    asking.remove(label);
  }
}

/// Close the window for real, without asking again.
///
/// `destroy` rather than `close`: `close` raises another close request, which
/// would come straight back here.
#[tauri::command]
fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
  stop_asking(window.label());
  window.destroy().map_err(|error| error.to_string())
}

/// The page asked, and the answer was to stay open.
#[tauri::command]
fn keep_window_open(window: tauri::WebviewWindow) {
  stop_asking(window.label());
}

/// How many windows have been opened after the first, for naming the next one.
static OPENED: AtomicUsize = AtomicUsize::new(0);

/// Open another window, on a font or on the list of fonts.
///
/// The request travels in the address, as it does when a browser opens a tab —
/// `?font=<id>` or `?fonts` — so the page reads it the same way in both. An id is
/// refused unless it is the kind of name the editor gives a font, which is all
/// this needs to know about it to put it in an address.
///
/// Async, because on Windows a window made from a command that holds the main
/// thread waits for that thread, and never appears.
#[tauri::command]
async fn open_window(app: tauri::AppHandle, font: Option<String>) -> Result<(), String> {
  let search = match font {
    Some(id)
      if !id.is_empty()
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') =>
    {
      format!("font={id}")
    }
    Some(_) => return Err("that is not the name of a font".into()),
    None => "fonts".into(),
  };
  let label = format!("font-{}", OPENED.fetch_add(1, Ordering::SeqCst) + 1);
  WebviewWindowBuilder::new(&app, label, WebviewUrl::App(format!("index.html?{search}").into()))
    .title("Typewright")
    .inner_size(1400.0, 900.0)
    .min_inner_size(900.0, 600.0)
    .build()
    .map(|_| ())
    .map_err(|error| error.to_string())
}

/// Name the window after the font it is on, so windows can be told apart.
#[tauri::command]
fn set_title(window: tauri::WebviewWindow, title: String) -> Result<(), String> {
  window.set_title(&title).map_err(|error| error.to_string())
}

/// How many windows are open besides this one.
///
/// Installing an update ends the whole program, so the window offering one asks
/// first: every other window is on a font, and perhaps a folder, of its own.
#[tauri::command]
fn other_windows(app: tauri::AppHandle, window: tauri::WebviewWindow) -> usize {
  app
    .webview_windows()
    .keys()
    .filter(|label| label.as_str() != window.label())
    .count()
}

/// The version of a newer release, if one has been published.
///
/// Asked once, by the window the application started with, of the manifest the
/// release workflow attaches to the latest published GitHub release. Windows
/// opened later are told there is nothing, so the offer is made once rather than
/// in every window. Always `None` in a debug build, which is somebody's work in
/// progress rather than an installed copy, and would otherwise offer to replace
/// itself with the last release.
#[tauri::command]
async fn check_for_update(
  app: tauri::AppHandle,
  window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
  if cfg!(debug_assertions) || window.label() != "main" {
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
      open_window,
      set_title,
      other_windows,
      check_for_update,
      install_update,
      hint_truetype
    ])
    .on_window_event(|window, event| match event {
      WindowEvent::CloseRequested { api, .. } => {
        let label = window.label().to_string();

        // Already asked and no answer: this is the second press, so let it close.
        let first = asking()
          .lock()
          .map(|mut asking| asking.insert(label.clone()))
          .unwrap_or(false);
        if !first {
          stop_asking(&label);
          return;
        }

        let asked = window
          .get_webview_window(&label)
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
          stop_asking(&label);
        }
      }
      WindowEvent::Destroyed => stop_asking(window.label()),
      _ => {}
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
