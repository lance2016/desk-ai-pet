//! Opening at login (a macOS login item for the app itself), writing a backup
//! file the user picks, and restarting after a restore.

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Launch-at-login states. Must match `LaunchAtLogin` in `src/platform/system.ts`.
const LOGIN_ON: &str = "on";
const LOGIN_OFF: &str = "off";
/// Registered, but switched off in System Settings, so macOS asks the user.
const LOGIN_APPROVAL: &str = "approval";
#[cfg(not(target_os = "macos"))]
const LOGIN_UNAVAILABLE: &str = "unavailable";

#[cfg(target_os = "macos")]
mod login_item {
    use objc2_service_management::{SMAppService, SMAppServiceStatus};

    pub fn status() -> &'static str {
        // SAFETY: ServiceManagement calls on the main app service have no preconditions.
        let status = unsafe { SMAppService::mainAppService().status() };
        if status == SMAppServiceStatus::Enabled {
            super::LOGIN_ON
        } else if status == SMAppServiceStatus::RequiresApproval {
            super::LOGIN_APPROVAL
        } else {
            super::LOGIN_OFF
        }
    }

    pub fn set(enabled: bool) -> Result<(), String> {
        // SAFETY: as above; errors come back as NSError values.
        let service = unsafe { SMAppService::mainAppService() };
        let result = unsafe {
            if enabled {
                service.registerAndReturnError()
            } else {
                service.unregisterAndReturnError()
            }
        };
        result.map_err(|error| error.localizedDescription().to_string())
    }

    pub fn open_settings() {
        // SAFETY: only opens the Login Items pane of System Settings.
        unsafe { SMAppService::openSystemSettingsLoginItems() };
    }
}

#[tauri::command]
pub fn launch_at_login_status() -> String {
    #[cfg(target_os = "macos")]
    return login_item::status().to_string();
    #[cfg(not(target_os = "macos"))]
    return LOGIN_UNAVAILABLE.to_string();
}

/// Turns opening at login on or off and returns the state macOS reports afterwards.
#[tauri::command]
pub fn set_launch_at_login(enabled: bool) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        // Turning off something that is already off fails in ServiceManagement; that is not an error here.
        if !enabled && login_item::status() == LOGIN_OFF {
            return Ok(LOGIN_OFF.to_string());
        }
        login_item::set(enabled)?;
        Ok(login_item::status().to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = enabled;
        Ok(LOGIN_UNAVAILABLE.to_string())
    }
}

#[tauri::command]
pub fn open_login_items_settings() {
    #[cfg(target_os = "macos")]
    login_item::open_settings();
}

/// The Privacy & Security → Microphone pane of System Settings.
const MICROPHONE_SETTINGS: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
const ACCESSIBILITY_SETTINGS: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
const MAX_LINK_CHARS: usize = 2048;

/// Whether a link from a chat reply or a settings page may be opened: a plain
/// web address, nothing that could start another app or look like a flag.
fn web_link(url: &str) -> bool {
    url.len() <= MAX_LINK_CHARS
        && (url.starts_with("https://") || url.starts_with("http://"))
        && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

fn open_with_system(target: &str) -> Result<(), String> {
    let status = std::process::Command::new("/usr/bin/open")
        .arg(target)
        .status()
        .map_err(|error| format!("Failed to open {target}: {error}"))?;
    if status.success() { Ok(()) } else { Err(format!("Failed to open {target}")) }
}

/// Opens a web link in the default browser; the app's windows never navigate away.
#[tauri::command]
pub fn open_link(url: String) -> Result<(), String> {
    if !web_link(&url) {
        return Err("Refusing to open a link that is not a web address".into());
    }
    open_with_system(&url)
}

/// Opens the microphone privacy settings, after the user refused access.
#[tauri::command]
pub fn open_microphone_settings() -> Result<(), String> {
    open_with_system(MICROPHONE_SETTINGS)
}

#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), String> {
    open_with_system(ACCESSIBILITY_SETTINGS)
}

/// Asks where to save the backup and writes it there. Returns false when the user cancels.
#[tauri::command]
pub async fn save_backup(app: AppHandle, contents: String, file_name: String) -> Result<bool, String> {
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("AI Pet backup", &["json"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = target.into_path().map_err(|error| format!("Invalid backup location: {error}"))?;
    write_whole(&path, contents.as_bytes()).map_err(|error| format!("Failed to write the backup: {error}"))?;
    Ok(true)
}

/// Asks where to save a portable character package and writes it there.
#[tauri::command]
pub async fn save_character_package(app: AppHandle, contents: String, file_name: String) -> Result<bool, String> {
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name(&file_name)
        .add_filter("AI Pet character", &["json"])
        .blocking_save_file()
    else {
        return Ok(false);
    };
    let path = target.into_path().map_err(|error| format!("Invalid character package location: {error}"))?;
    write_whole(&path, contents.as_bytes()).map_err(|error| format!("Failed to write the character package: {error}"))?;
    Ok(true)
}

/// Writes a file so it is either complete or untouched: first a temporary file
/// next to it, then a rename. A failure half way leaves no half backup behind,
/// and an older backup of the same name stays until the new one is whole.
pub(crate) fn write_whole(path: &std::path::Path, contents: &[u8]) -> std::io::Result<()> {
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    let temporary = path.with_file_name(format!(".{name}.partial"));
    let written = std::fs::write(&temporary, contents).and_then(|()| std::fs::rename(&temporary, path));
    if written.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    written
}

/// Starts the app again, so every window reads the restored data.
#[tauri::command]
pub fn restart_app(app: AppHandle) {
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::{web_link, write_whole};

    #[test]
    fn writes_a_whole_file_and_leaves_no_temporary_one() {
        let folder = std::env::temp_dir().join(format!("ai-pet-backup-test-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let path = folder.join("backup.json");
        std::fs::write(&path, b"old").unwrap();
        write_whole(&path, b"new").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        assert!(!folder.join(".backup.json.partial").exists());
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn opens_only_plain_web_links() {
        assert!(web_link("https://platform.deepseek.com/api_keys"));
        assert!(web_link("http://example.com/a?b=1"));
        assert!(!web_link("file:///etc/passwd"));
        assert!(!web_link("-a Calculator"));
        assert!(!web_link("https://a.com/x y"));
        assert!(!web_link("x-apple.systempreferences:com.apple.preference.security"));
    }
}
/// Seconds since the last keyboard or mouse event in the current session.
#[tauri::command]
pub fn system_idle_seconds() -> Option<f64> {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "CoreGraphics", kind = "framework")]
        unsafe extern "C" {
            fn CGEventSourceSecondsSinceLastEventType(state: i32, event_type: u32) -> f64;
        }
        let seconds = unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
        if seconds.is_finite() && seconds >= 0.0 { Some(seconds) } else { None }
    }
    #[cfg(not(target_os = "macos"))]
    { None }
}
