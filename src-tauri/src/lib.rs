mod db;
mod models;
mod render;

use std::{
    fs,
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::Mutex,
    time::{Duration, Instant},
};
use arboard::Clipboard;
use chrono::Utc;
use models::{EditRecipe, ExportRequest, ExportResult, MediaItem, NativeCaptureRequest, SaveCaptureRequest};
use tauri::{Emitter, Manager, State};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use uuid::Uuid;

struct AppState {
    db_path: PathBuf,
    data_dir: PathBuf,
    ffmpeg: String,
    whisper_cli: Option<String>,
    whisper_model: Option<String>,
    native_recording: Mutex<Option<NativeRecording>>,
}

struct NativeRecording {
    child: Child,
    id: String,
    title: String,
    source: String,
    media_path: PathBuf,
    started: Instant,
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

fn path_text(path: &Path) -> String { path.to_string_lossy().into_owned() }

fn validate_capture(request: &SaveCaptureRequest) -> Result<(), String> {
    if request.bytes.is_empty() { return Err("An empty capture cannot be saved.".into()); }
    if request.bytes.len() > 1_500_000_000 { return Err("Capture exceeds the 1.5 GB local safety limit.".into()); }
    if !matches!(request.extension.as_str(), "webm" | "mp4" | "png") { return Err("Unsupported capture extension.".into()); }
    if !matches!(request.kind.as_str(), "video" | "screenshot") { return Err("Invalid capture type.".into()); }
    if !matches!(request.source.as_str(), "screen" | "window" | "region") { return Err("Invalid capture source.".into()); }
    if request.title.trim().is_empty() || request.title.chars().count() > 96 { return Err("Title must be 1–96 characters.".into()); }
    Ok(())
}

fn validate_native_capture(request: &NativeCaptureRequest) -> Result<(), String> {
    if request.title.trim().is_empty() || request.title.chars().count() > 96 {
        return Err("Title must be 1–96 characters.".into());
    }
    if !matches!(request.source.as_str(), "screen" | "window" | "region") {
        return Err("Invalid capture source.".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn ensure_screen_capture_permission() -> Result<(), String> {
    let allowed = unsafe { CGPreflightScreenCaptureAccess() };
    if allowed { return Ok(()); }
    let _ = unsafe { CGRequestScreenCaptureAccess() };
    Err("LocalCut needs Screen Recording permission. Enable it in System Settings > Privacy & Security > Screen & System Audio Recording, then reopen the app.".into())
}

fn capture_destination(state: &AppState, title: &str, extension: &str) -> Result<(String, PathBuf), String> {
    let captures = state.data_dir.join("captures");
    fs::create_dir_all(&captures).map_err(|error| error.to_string())?;
    let id = Uuid::new_v4().to_string();
    let stem = format!("{}-{}-{}", render::safe_file_name(title), Utc::now().format("%Y%m%d-%H%M%S"), &id[..8]);
    Ok((id, captures.join(format!("{stem}.{extension}"))))
}

fn write_transcript(state: &AppState, media: &Path, destination: &Path) -> Result<(), String> {
    if let (Some(cli), Some(model)) = (&state.whisper_cli, &state.whisper_model) {
        let output_stem = destination.with_extension("");
        let status = Command::new(cli).arg("-m").arg(model).arg("-f").arg(media).arg("-otxt").arg("-of").arg(&output_stem).status();
        if matches!(status, Ok(value) if value.success()) && destination.exists() { return Ok(()); }
        fs::write(destination, "[Local transcription failed. Check WHISPER_CLI and WHISPER_MODEL.]\n").map_err(|error| error.to_string())?;
    } else {
        fs::write(destination, "[Local transcription is not configured. Set WHISPER_CLI and WHISPER_MODEL in .env if needed.]\n").map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn persist_existing_capture(
    state: &AppState,
    id: String,
    title: String,
    kind: String,
    source: String,
    media: PathBuf,
    duration_ms: u64,
) -> Result<MediaItem, String> {
    let metadata = fs::metadata(&media).map_err(|error| format!("Could not read capture file: {error}"))?;
    if metadata.len() == 0 { return Err("Capture was cancelled or produced an empty file.".into()); }
    let stem = media.file_stem().and_then(|value| value.to_str()).ok_or_else(|| "Could not resolve capture file name.".to_string())?;
    let parent = media.parent().ok_or_else(|| "Could not resolve capture folder.".to_string())?;
    let transcript = parent.join(format!("{stem}.transcript.txt"));
    let summary = parent.join(format!("{stem}.summary.md"));
    write_transcript(state, &media, &transcript)?;
    fs::write(&summary, format!("# {}\n\n- Date: {}\n- Type: {}\n- Source: {}\n- Duration: {:.1} seconds\n\n## Key moments\n\nNo notes added yet.\n", title, Utc::now().to_rfc3339(), kind, source, duration_ms as f64 / 1000.0)).map_err(|error| error.to_string())?;
    let poster = if kind == "video" {
        let destination = parent.join(format!("{stem}.poster.jpg"));
        render::poster(&state.ffmpeg, &media, &destination).ok().map(|_| path_text(&destination))
    } else {
        let destination = parent.join(format!("{stem}.poster.png"));
        fs::copy(&media, &destination).ok().map(|_| path_text(&destination))
    };
    let item = MediaItem {
        id, title, kind, source, media_path: path_text(&media), poster_path: poster,
        transcript_path: path_text(&transcript), summary_path: path_text(&summary), duration_ms,
        created_at: Utc::now().to_rfc3339(), recipe: EditRecipe::default()
    };
    db::insert(&state.db_path, &item)?;
    Ok(item)
}

#[tauri::command]
fn list_media(state: State<'_, AppState>) -> Result<Vec<MediaItem>, String> {
    #[cfg(debug_assertions)]
    eprintln!("LocalCut UI connected.");
    db::list(&state.db_path)
}

#[tauri::command]
fn save_capture(request: SaveCaptureRequest, state: State<'_, AppState>) -> Result<MediaItem, String> {
    validate_capture(&request)?;
    let (id, media) = capture_destination(&state, &request.title, &request.extension)?;
    let temporary = media.with_extension(format!("{}.partial", request.extension));
    fs::write(&temporary, &request.bytes).map_err(|error| format!("Could not write capture: {error}"))?;
    fs::rename(&temporary, &media).map_err(|error| format!("Could not complete capture: {error}"))?;
    persist_existing_capture(&state, id, request.title, request.kind, request.source, media, request.duration_ms)
}

fn native_screenshot_args(source: &str) -> Vec<&'static str> {
    let mut args = vec!["-x", "-t", "png"];
    match source {
        "screen" => args.extend(["-C", "-D1"]),
        "window" => args.extend(["-i", "-w", "-W", "-o"]),
        _ => args.extend(["-i", "-s", "-Jselection"]),
    }
    args
}

fn native_video_args(source: &str, microphone: bool) -> Vec<&'static str> {
    let mut args = vec!["-v", "-x", "-k"];
    if microphone { args.push("-g"); }
    match source {
        "screen" => args.push("-D1"),
        // macOS'un video seçicisi pencereyi seçili bir alan olarak kaydeder.
        "window" => args.extend(["-i", "-U", "-Jvideo"]),
        _ => args.extend(["-i", "-U", "-Jvideo"]),
    }
    args
}

#[tauri::command]
async fn native_screenshot(request: NativeCaptureRequest, state: State<'_, AppState>) -> Result<MediaItem, String> {
    validate_native_capture(&request)?;
    #[cfg(not(target_os = "macos"))]
    return Err("Native screenshots are currently available only on macOS.".into());

    #[cfg(target_os = "macos")]
    {
        ensure_screen_capture_permission()?;
        let (id, media) = capture_destination(&state, &request.title, "png")?;
        let args = native_screenshot_args(&request.source);
        let command_media = media.clone();
        let status = tauri::async_runtime::spawn_blocking(move || {
            Command::new("/usr/sbin/screencapture").args(args).arg(&command_media).status()
        }).await.map_err(|error| format!("The native capture task failed: {error}"))?
          .map_err(|error| format!("Could not start the macOS screen capture tool: {error}"))?;
        if !status.success() || !media.exists() {
            let _ = fs::remove_file(&media);
            return Err("Screenshot was cancelled or Screen Recording permission was denied.".into());
        }
        persist_existing_capture(&state, id, request.title, "screenshot".into(), request.source, media, 0)
    }
}

#[tauri::command]
fn native_start_recording(request: NativeCaptureRequest, state: State<'_, AppState>) -> Result<(), String> {
    validate_native_capture(&request)?;
    #[cfg(not(target_os = "macos"))]
    return Err("Native screen recording is currently available only on macOS.".into());

    #[cfg(target_os = "macos")]
    {
        ensure_screen_capture_permission()?;
        let mut active = state.native_recording.lock().map_err(|_| "Could not lock recording state.".to_string())?;
        if active.is_some() { return Err("A screen recording is already in progress.".into()); }
        let (id, media_path) = capture_destination(&state, &request.title, "mov")?;
        let mut child = Command::new("/usr/sbin/screencapture")
            .args(native_video_args(&request.source, request.microphone))
            .arg(&media_path)
            .spawn()
            .map_err(|error| format!("Could not start macOS screen recording: {error}"))?;
        std::thread::sleep(Duration::from_millis(400));
        if child.try_wait().map_err(|error| error.to_string())?.is_some() {
            let _ = fs::remove_file(&media_path);
            return Err("macOS could not start recording. Check LocalCut’s Screen Recording permission and reopen the app.".into());
        }
        *active = Some(NativeRecording {
            child,
            id,
            title: request.title,
            source: request.source,
            media_path,
            started: Instant::now(),
        });
        Ok(())
    }
}

#[tauri::command]
fn open_screen_capture_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("/usr/bin/open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn().map_err(|error| format!("Could not open System Settings: {error}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    Err("Screen Recording settings cannot be opened automatically on this platform.".into())
}

#[tauri::command]
async fn native_stop_recording(state: State<'_, AppState>) -> Result<MediaItem, String> {
    #[cfg(not(target_os = "macos"))]
    return Err("Native screen recording is currently available only on macOS.".into());

    #[cfg(target_os = "macos")]
    {
        let recording = state.native_recording.lock().map_err(|_| "Could not lock recording state.".to_string())?.take()
            .ok_or_else(|| "There is no active recording to stop.".to_string())?;
        let duration_ms = recording.started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        let NativeRecording { mut child, id, title, source, media_path, .. } = recording;
        tauri::async_runtime::spawn_blocking(move || {
            if child.try_wait().map_err(|error| error.to_string())?.is_none() {
                let signal = Command::new("/bin/kill").args(["-INT", &child.id().to_string()]).status().map_err(|error| error.to_string())?;
                if !signal.success() { return Err("Could not send the stop signal to macOS recording.".to_string()); }
            }
            for _ in 0..150 {
                if child.try_wait().map_err(|error| error.to_string())?.is_some() { return Ok(()); }
                std::thread::sleep(Duration::from_millis(100));
            }
            let _ = child.kill();
            let _ = child.wait();
            Err("macOS could not finish the recording file in time.".to_string())
        }).await.map_err(|error| format!("The native recording task failed: {error}"))??;
        if !media_path.exists() {
            return Err("Recording could not be created. Allow LocalCut in System Settings > Privacy & Security > Screen & System Audio Recording.".into());
        }
        persist_existing_capture(&state, id, title, "video".into(), source, media_path, duration_ms)
    }
}

#[tauri::command]
fn update_recipe(id: String, title: String, recipe: EditRecipe, state: State<'_, AppState>) -> Result<(), String> {
    if id.len() > 64 { return Err("Invalid recording ID.".into()); }
    let title = render::safe_file_name(&title);
    let recipe = render::validate_recipe(recipe);
    db::update_recipe(&state.db_path, &id, &title, &recipe)
}

#[tauri::command]
fn export_media(request: ExportRequest, state: State<'_, AppState>) -> Result<ExportResult, String> {
    if request.id.len() > 64 { return Err("Invalid recording ID.".into()); }
    let item = db::get(&state.db_path, &request.id)?;
    render::export(&state.ffmpeg, &state.data_dir.join("exports"), &item, &request)
}

#[tauri::command]
fn copy_path(path: String) -> Result<(), String> {
    let value = PathBuf::from(&path);
    if !value.exists() { return Err("The file to copy no longer exists.".into()); }
    Clipboard::new().and_then(|mut clipboard| clipboard.set_text(path)).map_err(|error| format!("Clipboard is unavailable: {error}"))
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    let value = PathBuf::from(path);
    if !value.exists() { return Err("The file to reveal no longer exists.".into()); }
    let folder = value.parent().ok_or_else(|| "Parent folder not found.".to_string())?;
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(folder).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(folder).status();
    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open").arg(folder).status();
    match status { Ok(value) if value.success() => Ok(()), Ok(_) => Err("The file manager could not open the location.".into()), Err(error) => Err(format!("File manager unavailable: {error}")) }
}

#[tauri::command]
fn data_location(state: State<'_, AppState>) -> String { path_text(&state.data_dir) }

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show LocalCut", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop Recording", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &stop, &quit])?;
    let mut builder = TrayIconBuilder::with_id("localcut").tooltip("LocalCut").menu(&menu).show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "stop" => { let _ = app.emit("capture://stop-requested", ()); },
            "show" => { if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); } },
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() { builder = builder.icon(icon.clone()); }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|error| format!("Veri klasörü çözümlenemedi: {error}"))?;
            fs::create_dir_all(&data_dir)?;
            let db_path = data_dir.join("localcut.sqlite3");
            db::migrate(&db_path).map_err(|error| format!("SQLite hazırlanamadı: {error}"))?;
            app.manage(AppState {
                db_path,
                data_dir,
                ffmpeg: std::env::var("FFMPEG_BIN").unwrap_or_else(|_| "ffmpeg".into()),
                whisper_cli: std::env::var("WHISPER_CLI").ok().filter(|value| !value.trim().is_empty()),
                whisper_model: std::env::var("WHISPER_MODEL").ok().filter(|value| !value.trim().is_empty()),
                native_recording: Mutex::new(None),
            });
            build_tray(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_media, save_capture, native_screenshot, native_start_recording, native_stop_recording,
            open_screen_capture_settings, update_recipe, export_media, copy_path, reveal_path, data_location
        ])
        .run(tauri::generate_context!())
        .expect("LocalCut başlatılamadı");
}

#[cfg(test)]
mod native_capture_tests {
    use super::{native_screenshot_args, native_video_args};

    #[test]
    fn builds_safe_native_capture_arguments() {
        assert_eq!(native_screenshot_args("screen"), ["-x", "-t", "png", "-C", "-D1"]);
        assert!(native_screenshot_args("window").contains(&"-w"));
        assert!(native_screenshot_args("region").contains(&"-s"));
        assert!(native_video_args("screen", true).contains(&"-g"));
        assert!(!native_video_args("screen", false).contains(&"-g"));
        assert!(native_video_args("region", false).contains(&"-Jvideo"));
    }
}
