//! Diagnostics: the app's log file in `~/Library/Logs/<identifier>/`, and the
//! commands settings uses to show, clear and export it. Warnings and errors
//! from every window arrive through `diagnostics_log`. Nothing here leaves the
//! computer unless the user saves the export and sends it on.
//! Must match `src/platform/diagnostics.ts`.

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager, Runtime, plugin::TauriPlugin};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

/// The log file is `<FILE_STEM>.log`; rotated ones are `<FILE_STEM>_<date>.log`.
const FILE_STEM: &str = "ai-pet";
const MAX_FILE_BYTES: u128 = 1_000_000;
/// The current file and up to this many rotated ones, oldest dropped first.
const KEEP_FILES: usize = 3;
/// What settings shows and the export carries: the end of the logs, newest last.
const MAX_SHOWN_BYTES: u64 = 256 * 1024;
/// One message from a window. Longer ones are cut, so a runaway error cannot flood the file.
const MAX_MESSAGE_CHARS: usize = 4000;
/// Where messages from the windows appear in the log.
const WEBVIEW_TARGET: &str = "webview";

/// Lines read: `[2026-11-19][13:05:01][ai_pet_lib::llm][WARN] message`, in local time.
pub fn log_plugin<R: Runtime>() -> TauriPlugin<R> {
    let zone = TimezoneStrategy::UseLocal;
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir { file_name: Some(FILE_STEM.into()) }))
        .target(Target::new(TargetKind::Stderr))
        .level(log::LevelFilter::Info)
        .max_file_size(MAX_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEEP_FILES))
        .timezone_strategy(zone.clone())
        .format(move |out, message, record| {
            let now = zone.get_now();
            out.finish(format_args!(
                "[{:04}-{:02}-{:02}][{:02}:{:02}:{:02}][{}][{}] {}",
                now.year(),
                now.month() as u8,
                now.day(),
                now.hour(),
                now.minute(),
                now.second(),
                record.target(),
                record.level(),
                message
            ))
        })
        .build()
}

/// Panics go to the log too, before the default report and the abort.
pub fn log_panics() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        previous(info);
    }));
}

fn log_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path().app_log_dir().map_err(|error| format!("Cannot find the log folder: {error}"))
}

/// The log files in `dir`, oldest first; the current one is the newest.
fn log_files(dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<(std::time::SystemTime, PathBuf)> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "log"))
        .filter(|path| path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with(FILE_STEM)))
        .filter_map(|path| Some((fs::metadata(&path).and_then(|meta| meta.modified()).ok()?, path)))
        .collect();
    files.sort();
    files.into_iter().map(|(_, path)| path).collect()
}

/// The last `limit` bytes of `path`, starting at a whole line.
fn tail(path: &Path, limit: u64) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let size = file.metadata()?.len();
    let start = size.saturating_sub(limit);
    // One byte early, to tell whether `start` is already the beginning of a line.
    file.seek(SeekFrom::Start(start.saturating_sub(1)))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let whole = if start == 0 {
        &bytes[..]
    } else {
        let line_start = bytes.iter().position(|byte| *byte == b'\n').map_or(bytes.len(), |at| at + 1);
        &bytes[line_start..]
    };
    Ok(String::from_utf8_lossy(whole).into_owned())
}

/// The end of the logs across files, newest last, at most `limit` bytes.
fn recent_logs(dir: &Path, limit: u64) -> String {
    let mut left = limit;
    let mut parts = Vec::new();
    for path in log_files(dir).iter().rev() {
        if left == 0 {
            break;
        }
        match tail(path, left) {
            Ok(text) => {
                left = left.saturating_sub(text.len() as u64);
                parts.push(text);
            }
            Err(error) => log::warn!("Cannot read {}: {error}", path.display()),
        }
    }
    parts.reverse();
    parts.concat()
}

/// Empties the current file, which the logger keeps open, and removes the rotated ones.
fn clear(dir: &Path) -> std::io::Result<()> {
    let current = dir.join(format!("{FILE_STEM}.log"));
    for path in log_files(dir) {
        if path == current {
            fs::OpenOptions::new().write(true).open(&path)?.set_len(0)?;
        } else {
            fs::remove_file(&path)?;
        }
    }
    Ok(())
}

fn cut(message: &str, limit: usize) -> &str {
    message.char_indices().nth(limit).map_or(message, |(at, _)| &message[..at])
}

/// A warning or error from a window. `window` says which one.
#[tauri::command]
pub fn diagnostics_log(level: String, window: String, message: String) -> Result<(), String> {
    let window = cut(&window, 32);
    let message = cut(&message, MAX_MESSAGE_CHARS);
    match level.as_str() {
        "warn" => log::warn!(target: WEBVIEW_TARGET, "[{window}] {message}"),
        "error" => log::error!(target: WEBVIEW_TARGET, "[{window}] {message}"),
        _ => return Err("Unknown log level".into()),
    }
    Ok(())
}

#[tauri::command]
pub fn diagnostics_read_logs(app: AppHandle) -> Result<String, String> {
    Ok(recent_logs(&log_dir(&app)?, MAX_SHOWN_BYTES))
}

#[tauri::command]
pub fn diagnostics_clear_logs(app: AppHandle) -> Result<(), String> {
    clear(&log_dir(&app)?).map_err(|error| format!("Cannot clear the logs: {error}"))
}

#[tauri::command]
pub async fn diagnostics_reveal_logs(app: AppHandle) -> Result<(), String> {
    let dir = log_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&dir).map_err(|error| format!("Cannot create the log folder: {error}"))?;
        let status = Command::new("/usr/bin/open").arg(&dir).status().map_err(|error| format!("Cannot open the log folder: {error}"))?;
        if status.success() { Ok(()) } else { Err("Cannot open the log folder".into()) }
    })
    .await
    .map_err(|_| "Cannot open the log folder".to_string())?
}

fn macos_version() -> String {
    Command::new("/usr/bin/sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|text| text.trim().to_owned())
        .unwrap_or_else(|| "unknown".into())
}

/// Asks where to save, then writes the version, the system and the recent logs there.
/// Returns false when the user cancels.
#[tauri::command]
pub async fn diagnostics_export(app: AppHandle, file_name: String) -> Result<bool, String> {
    let Some(target) = app.dialog().file().set_file_name(&file_name).add_filter("Text", &["txt"]).blocking_save_file() else {
        return Ok(false);
    };
    let path = target.into_path().map_err(|error| format!("Invalid export location: {error}"))?;
    let report = format!(
        "AI Pet {}\nmacOS {} ({})\n\n{}",
        app.package_info().version,
        macos_version(),
        std::env::consts::ARCH,
        recent_logs(&log_dir(&app)?, MAX_SHOWN_BYTES)
    );
    fs::write(&path, report).map_err(|error| format!("Failed to write the export: {error}"))?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ai-pet-diagnostics-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_aged(path: &Path, text: &str, age_secs: u64) {
        fs::write(path, text).unwrap();
        let when = std::time::SystemTime::now() - std::time::Duration::from_secs(age_secs);
        fs::File::options().write(true).open(path).unwrap().set_modified(when).unwrap();
    }

    #[test]
    fn reads_the_end_across_files_from_a_whole_line() {
        let dir = folder("read");
        write_aged(&dir.join("ai-pet_2026-11-18.log"), "old one\nold two\n", 60);
        write_aged(&dir.join("ai-pet.log"), "new one\n", 0);
        fs::write(dir.join("other.txt"), "not a log").unwrap();
        assert_eq!(recent_logs(&dir, 1_000), "old one\nold two\nnew one\n");
        assert_eq!(recent_logs(&dir, 16), "old two\nnew one\n");
        assert_eq!(recent_logs(&dir, 14), "new one\n");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn clearing_empties_the_current_file_and_removes_rotated_ones() {
        let dir = folder("clear");
        write_aged(&dir.join("ai-pet_2026-11-18.log"), "old\n", 60);
        write_aged(&dir.join("ai-pet.log"), "new\n", 0);
        clear(&dir).unwrap();
        assert_eq!(log_files(&dir), vec![dir.join("ai-pet.log")]);
        assert_eq!(fs::read_to_string(dir.join("ai-pet.log")).unwrap(), "");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn cuts_long_messages_on_a_character() {
        assert_eq!(cut("验证码", 2), "验证");
        assert_eq!(cut("ok", 10), "ok");
        assert!(diagnostics_log("info".into(), "main".into(), "x".into()).is_err());
    }
}
