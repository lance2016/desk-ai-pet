//! Reads the current selection only when the user requests translation.
use std::sync::Mutex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Selection(Mutex<Value>);

#[cfg(target_os = "macos")]
mod accessibility {
    use std::ffi::{c_char, c_void, CStr};
    use std::ptr;
    type CF = *const c_void;
    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateApplication(pid: i32) -> CF;
        fn AXUIElementCopyAttributeValue(element: CF, attribute: CF, value: *mut CF) -> i32;
        fn AXUIElementSetMessagingTimeout(element: CF, seconds: f32) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(value: CF);
        fn CFGetTypeID(value: CF) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFStringCreateWithCString(alloc: CF, text: *const c_char, encoding: u32) -> CF;
        fn CFStringGetLength(value: CF) -> isize;
        fn CFStringGetMaximumSizeForEncoding(length: isize, encoding: u32) -> isize;
        fn CFStringGetCString(value: CF, buffer: *mut c_char, size: isize, encoding: u32) -> bool;
    }
    const UTF8: u32 = 0x0800_0100;
    /// How long a read may wait on the app that has the selection. The default is
    /// about 6 seconds, and the reads run on the main thread when the shortcut is pressed.
    const AX_TIMEOUT_SECONDS: f32 = 1.0;
    unsafe fn attribute(element: CF, name: &CStr) -> Option<CF> {
        let key = unsafe { CFStringCreateWithCString(ptr::null(), name.as_ptr(), UTF8) };
        if key.is_null() { return None; }
        let mut value = ptr::null();
        let result = unsafe { AXUIElementCopyAttributeValue(element, key, &mut value) };
        unsafe { CFRelease(key) };
        if result == 0 && !value.is_null() { Some(value) } else { None }
    }
    unsafe fn string(value: CF) -> Option<String> {
        if unsafe { CFGetTypeID(value) != CFStringGetTypeID() } { return None; }
        let length = unsafe { CFStringGetLength(value) };
        if length > 16_000 { return None; }
        let size = unsafe { CFStringGetMaximumSizeForEncoding(length, UTF8) } + 1;
        if size <= 0 || size > 64_001 { return None; }
        let mut bytes = vec![0u8; size as usize];
        if !unsafe { CFStringGetCString(value, bytes.as_mut_ptr().cast(), size, UTF8) } { return None; }
        unsafe { CStr::from_ptr(bytes.as_ptr().cast()) }.to_str().ok().map(str::to_owned)
    }
    pub fn trusted() -> bool { unsafe { AXIsProcessTrusted() } }
    /// The selection in the app in front. The app is asked directly: the system-wide element's
    /// focused element fails with kAXErrorCannotComplete on macOS 15 (seen with Ghostty in front),
    /// and the pet's panels never activate the app, so the app in front is the one the user selected in.
    /// The app in front, unless it is the pet itself.
    pub fn front_pid() -> Option<i32> {
        let pid = objc2_app_kit::NSWorkspace::sharedWorkspace().frontmostApplication()?.processIdentifier();
        (pid > 0 && pid != std::process::id() as i32).then_some(pid)
    }
    pub fn selected() -> Option<String> {
        if !trusted() { return None; }
        let pid = front_pid()?;
        unsafe {
            let app = AXUIElementCreateApplication(pid);
            if app.is_null() { return None; }
            AXUIElementSetMessagingTimeout(app, AX_TIMEOUT_SECONDS);
            let focused = attribute(app, c"AXFocusedUIElement");
            CFRelease(app);
            let focused = focused?;
            AXUIElementSetMessagingTimeout(focused, AX_TIMEOUT_SECONDS);
            let role = attribute(focused, c"AXRole");
            let subrole = attribute(focused, c"AXSubrole");
            let mut secure = false;
            for value in [role, subrole].into_iter().flatten() {
                secure |= string(value).is_some_and(|s| s.contains("Secure"));
                CFRelease(value);
            }
            if secure { CFRelease(focused); return None; }
            let value = attribute(focused, c"AXSelectedText");
            CFRelease(focused);
            let value = value?;
            let text = string(value);
            CFRelease(value);
            text.filter(|s| !s.trim().is_empty() && s.len() <= 16_000)
        }
    }
}

/// The translation panel: one of the pet's panels (`POPOVERS` in lib.rs), opened beside it.
pub const WINDOW: &str = "translation";

/// `copied`: the text is what the user last copied, not a selection that was read.
/// Must be called on the main thread.
fn show_selection(app: &AppHandle, text: Option<String>, copied: bool, auto: bool) {
    let status = if copied { "copied" } else if !selection_status() { "permission" } else if text.is_none() { "empty" } else { "ok" };
    if let Ok(mut state) = app.state::<Selection>().0.lock() { *state = json!({"text": text.unwrap_or_default(), "status": status, "auto": auto}); }
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.emit("pet://translation-open", ());
    }
    if let Err(error) = crate::show_beside_pet(app, WINDOW) { log::warn!("failed to show translation: {error}"); }
}

/// The panel was put away (its close button, Esc, ⌘W): a translation still coming in is stopped.
pub fn put_away(app: &AppHandle) {
    if let Some(state) = app.try_state::<std::sync::Arc<crate::llm::LlmState>>() { state.cancel_window(WINDOW); }
    let _ = app.emit_to(WINDOW, "pet://translation-hide", ());
}

#[tauri::command]
pub fn selection_status() -> bool {
    #[cfg(target_os = "macos")]
    return accessibility::trusted();
    #[cfg(not(target_os = "macos"))]
    false
}

/// Opens the translation panel with the selected text. `auto`: the translation shortcut was pressed,
/// so the selection is translated straight away. Where accessibility cannot read it (Chrome,
/// Electron apps, WeChat), ⌘C is pressed for the user (`handover::copy_from_front`); where that
/// copies nothing either (a program that draws its own selection, such as Claude Code in a
/// terminal), what was copied in the last minute is used. From the menu it only opens the panel:
/// the user may want to type something else, and nothing is copied for them.
/// Must be called on the main thread.
pub fn open(app: &AppHandle, auto: bool) {
    #[cfg(target_os = "macos")]
    let read = accessibility::selected();
    #[cfg(target_os = "macos")]
    let selected = match (&read, auto && accessibility::trusted(), accessibility::front_pid()) {
        (None, true, Some(pid)) => crate::handover::copy_from_front(app, pid),
        _ => read,
    };
    #[cfg(target_os = "macos")]
    let copied = if auto && selected.is_none() { crate::handover::recent_copy(app) } else { None };
    #[cfg(not(target_os = "macos"))]
    let (selected, copied): (Option<String>, Option<String>) = (None, None);
    let from_copy = copied.is_some();
    let text = selected.or(copied);
    let auto = auto && text.is_some();
    show_selection(app, text, from_copy, auto);
}

#[tauri::command]
pub fn open_translation(app: AppHandle) { open(&app, false); }

#[tauri::command]
pub fn take_translation_selection(state: State<'_, Selection>) -> Value {
    state.0.lock().map(|mut value| std::mem::take(&mut *value)).unwrap_or(Value::Null)
}
