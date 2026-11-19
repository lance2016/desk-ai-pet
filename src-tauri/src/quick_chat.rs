//! The global shortcut that calls up the quick chat bar under the pet, and the
//! keyboard focus the bar needs.

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use std::sync::Mutex;
use tauri_plugin_global_shortcut::{
    GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};

const MAIN_WINDOW: &str = "main";
/// Tells the pet window to open or close the bar. Must match `src/platform/petWindow.ts`.
const QUICK_CHAT_EVENT: &str = "pet://quick-chat";
/// Combinations macOS or nearly every app already uses; taking one would break
/// it everywhere. Must match `RESERVED_SHORTCUTS` in `src/preferences/QuickChatPreferences.ts`.
const RESERVED_SHORTCUTS: [&str; 28] = [
    "Super+KeyA",
    "Super+KeyC",
    "Super+KeyV",
    "Super+KeyX",
    "Super+KeyZ",
    "Shift+Super+KeyZ",
    "Super+KeyQ",
    "Super+KeyW",
    "Super+KeyH",
    "Super+KeyM",
    "Super+KeyS",
    "Super+KeyF",
    "Super+KeyN",
    "Super+KeyO",
    "Super+KeyP",
    "Super+KeyT",
    "Super+Space",
    "Control+Space",
    "Control+Super+Space",
    "Super+Tab",
    "Shift+Super+Tab",
    "Super+Comma",
    "Super+Backquote",
    "Control+Super+KeyF",
    "Control+Super+KeyQ",
    "Shift+Super+Digit3",
    "Shift+Super+Digit4",
    "Shift+Super+Digit5",
];
/// Longest accelerator the settings page can record, e.g. "Control+Alt+Shift+Super+BracketRight".
const MAX_SHORTCUT_LEN: usize = 64;

/// Called by the shortcut plugin for every press and release.
#[derive(Default)]
pub struct Shortcuts(Mutex<[Option<Shortcut>; 2]>);

pub fn on_shortcut(app: &AppHandle, shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let is_translation = app.state::<Shortcuts>().0.lock().map(|slots| slots[1].as_ref() == Some(shortcut)).unwrap_or(false);
    if is_translation {
        crate::translation::open(app);
        return;
    }
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    // A pet hidden from the menu comes back to answer, without taking the keyboard yet:
    // the bar takes it on purpose with `take_keyboard`.
    if !window.is_visible().unwrap_or(true) {
        crate::reveal_pet(app);
    }
    if let Err(error) = app.emit_to(MAIN_WINDOW, QUICK_CHAT_EVENT, ()) {
        log::warn!("failed to emit quick chat event: {error}");
    }
}

/// Replaces the quick chat shortcut, or removes it with `None`. Async so that
/// the plugin can hop to the main thread without waiting on itself.
#[tauri::command]
pub async fn set_quick_chat_shortcut(app: AppHandle, shortcut: Option<String>) -> Result<(), String> {
    set_shortcut(&app, 0, shortcut)
}

#[tauri::command]
pub async fn set_translation_shortcut(app: AppHandle, shortcut: Option<String>) -> Result<(), String> {
    set_shortcut(&app, 1, shortcut)
}

fn set_shortcut(app: &AppHandle, index: usize, shortcut: Option<String>) -> Result<(), String> {
    let parsed = shortcut.as_deref().map(parse_shortcut).transpose()?;
    let state = app.state::<Shortcuts>();
    let mut slots = state.0.lock().map_err(|_| "Shortcut state unavailable")?;
    if slots[index] == parsed { return Ok(()); }
    if parsed.is_some() && slots[1 - index] == parsed { return Err("Shortcut already in use".into()); }
    let manager = app.global_shortcut();
    if let Some(value) = parsed {
        manager.register(value).map_err(|error| {
            log::warn!("failed to register shortcut {value}: {error}");
            error.to_string()
        })?;
    }
    if let Some(old) = slots[index] {
        if let Err(error) = manager.unregister(old) {
            if let Some(value) = parsed { let _ = manager.unregister(value); }
            return Err(error.to_string());
        }
    }
    slots[index] = parsed;
    Ok(())
}

/// Parses an accelerator such as "Shift+Super+Space". It must hold Control or
/// Command: since macOS 15 the system no longer delivers global shortcuts
/// whose only modifiers are Option or Option-Shift. Matches `recordShortcut`
/// in `src/preferences/QuickChatPreferences.ts`.
fn parse_shortcut(value: &str) -> Result<Shortcut, String> {
    if value.len() > MAX_SHORTCUT_LEN {
        return Err("Unsupported shortcut".into());
    }
    if RESERVED_SHORTCUTS.contains(&value) {
        return Err("This shortcut belongs to the system or other apps".into());
    }
    let shortcut: Shortcut = value.parse().map_err(|_| "Unsupported shortcut".to_string())?;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::SUPER)
    {
        return Err("A shortcut needs Control or Command".into());
    }
    Ok(shortcut)
}

fn pet_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| "main window is unavailable".to_string())
}

/// Lets the bar take typing without bringing the app to the front.
#[tauri::command]
pub fn take_pet_keyboard(app: AppHandle) -> Result<(), String> {
    let window = pet_window(&app)?;
    #[cfg(target_os = "macos")]
    return crate::floating_panel::take_keyboard(&window).map_err(|error| error.to_string());
    #[cfg(not(target_os = "macos"))]
    window.set_focus().map_err(|error| error.to_string())
}

/// Hands typing back to the app the user was in when the bar closes.
#[tauri::command]
pub fn release_pet_keyboard(app: AppHandle) -> Result<(), String> {
    let window = pet_window(&app)?;
    #[cfg(target_os = "macos")]
    return crate::floating_panel::release_keyboard(&window).map_err(|error| error.to_string());
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::parse_shortcut;

    #[test]
    fn accepts_shortcuts_with_control_or_command() {
        assert!(parse_shortcut("Shift+Super+Space").is_ok());
        assert!(parse_shortcut("Control+Alt+KeyK").is_ok());
    }

    #[test]
    fn refuses_option_only_and_unknown_shortcuts() {
        assert!(parse_shortcut("Alt+Space").is_err());
        assert!(parse_shortcut("Alt+Shift+Space").is_err());
        assert!(parse_shortcut("Super+Nonsense").is_err());
    }

    #[test]
    fn refuses_combinations_the_system_uses() {
        assert!(parse_shortcut("Super+KeyC").is_err());
        assert!(parse_shortcut("Super+Space").is_err());
        assert!(parse_shortcut("Super+Tab").is_err());
    }
}
