//! Reads the current selection only when the user requests translation.
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct Selection(Mutex<Value>);

#[derive(Default)]
pub struct SelectionFloat {
    enabled: AtomicBool,
    expanded: AtomicBool,
    text: Mutex<Option<String>>,
    /// The selection monitor, asleep while the float is off; turning it on wakes it.
    monitor: Mutex<Option<std::thread::Thread>>,
}

/// Must match the `selection-float` window width in `tauri.conf.json`.
const FLOAT_WIDTH: f64 = 216.0;
const FLOAT_HEIGHT: f64 = 38.0;
const RESULT_WIDTH: f64 = 340.0;
const RESULT_HEIGHT: f64 = 220.0;
/// The float keeps this far from the edges of the usable area (menu bar and Dock excluded).
const EDGE_GAP: f64 = 8.0;
/// How far the float sits from the cursor, so it does not cover the last word selected.
const CURSOR_GAP: (f64, f64) = (10.0, 12.0);

/// Where a float of `size` goes for a selection made from `start` to `end`, inside `work`. Below
/// the cursor, unless the selection was made upwards (the text is under the cursor, not above it)
/// or there is no room below: then above it, clear of the line the cursor is on.
fn float_spot(start: (f64, f64), end: (f64, f64), size: (f64, f64), work: crate::Area) -> (f64, f64) {
    let (left, top) = (work.x + EDGE_GAP, work.y + EDGE_GAP);
    let right = (work.x + work.width - EDGE_GAP - size.0).max(left);
    let bottom = (work.y + work.height - EDGE_GAP - size.1).max(top);
    let below = end.1 + CURSOR_GAP.1;
    let above = end.1 - CURSOR_GAP.1 - size.1;
    let upwards = end.1 < start.1 - CURSOR_GAP.1;
    let y = if (upwards || below > bottom) && above >= top { above } else { below };
    ((end.0 + CURSOR_GAP.0).clamp(left, right), y.clamp(top, bottom))
}

/// The usable area under a point on screen, in logical pixels.
fn work_area_at(app: &AppHandle, point: (f64, f64)) -> Option<crate::Area> {
    crate::work_area_under(app, crate::Area { x: point.0, y: point.1, width: 0.0, height: 0.0 })
}

#[cfg(target_os = "macos")]
mod accessibility {
    use std::ffi::{c_char, c_void, CStr};
    use std::ptr;
    type CF = *const c_void;
    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateSystemWide() -> CF;
        fn AXUIElementCopyAttributeValue(element: CF, attribute: CF, value: *mut CF) -> i32;
        fn AXUIElementGetPid(element: CF, pid: *mut i32) -> i32;
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
    pub fn selected() -> Option<String> {
        if !trusted() { return None; }
        unsafe {
            let system = AXUIElementCreateSystemWide();
            if system.is_null() { return None; }
            // On the system-wide element this is the default for every element read after it.
            AXUIElementSetMessagingTimeout(system, AX_TIMEOUT_SECONDS);
            let focused = attribute(system, c"AXFocusedUIElement");
            CFRelease(system);
            let focused = focused?;
            let mut pid = 0;
            if AXUIElementGetPid(focused, &mut pid) != 0 || pid == std::process::id() as i32 {
                CFRelease(focused);
                return None;
            }
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

/// Must be called on the main thread.
fn show_selection(app: &AppHandle, text: Option<String>, auto: bool, result: Option<String>) {
    let status = if !selection_status() { "permission" } else if text.is_none() { "empty" } else { "ok" };
    if let Ok(mut state) = app.state::<Selection>().0.lock() { *state = json!({"text": text.unwrap_or_default(), "status": status, "auto": auto, "result": result.unwrap_or_default()}); }
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
/// so a selection it found is translated straight away, as the float's 翻译 does. From the menu it
/// only opens the panel: the user may want to type something else.
pub fn open(app: &AppHandle, auto: bool) {
    #[cfg(target_os = "macos")]
    let text = accessibility::selected();
    #[cfg(not(target_os = "macos"))]
    let text: Option<String> = None;
    hide_selection_float(app);
    let auto = auto && text.is_some();
    show_selection(app, text, auto, None);
}

#[tauri::command]
pub fn open_translation(app: AppHandle) { open(&app, false); }

#[tauri::command]
pub fn take_translation_selection(state: State<'_, Selection>) -> Value {
    state.0.lock().map(|mut value| std::mem::take(&mut *value)).unwrap_or(Value::Null)
}

fn hide_selection_float(app: &AppHandle) {
    app.state::<SelectionFloat>().expanded.store(false, Ordering::Relaxed);
    if let Ok(mut text) = app.state::<SelectionFloat>().text.lock() { *text = None; }
    if let Some(state) = app.try_state::<std::sync::Arc<crate::llm::LlmState>>() { state.cancel_window("selection-float"); }
    if let Some(window) = app.get_webview_window("selection-float") { let _ = window.hide(); }
}

#[tauri::command]
pub fn set_selection_float(app: AppHandle, enabled: bool) {
    let float = app.state::<SelectionFloat>();
    float.enabled.store(enabled, Ordering::Relaxed);
    if !enabled { hide_selection_float(&app); return; }
    if let Some(monitor) = float.monitor.lock().ok().and_then(|monitor| monitor.clone()) { monitor.unpark(); }
}

#[tauri::command]
pub fn translate_floating_selection(app: AppHandle, result: Option<String>) {
    let text = app.state::<SelectionFloat>().text.lock().ok().and_then(|mut text| text.take());
    let result = result.filter(|value| value.len() <= 32_000);
    hide_selection_float(&app);
    if text.is_some() { show_selection(&app, text, false, result); }
}

#[tauri::command]
pub fn expand_selection_float(app: AppHandle) -> Result<String, String> {
    let text = app.state::<SelectionFloat>().text.lock().map_err(|_| "Selection unavailable")?.clone().ok_or("Selection expired")?;
    let window = app.get_webview_window("selection-float").ok_or("Window unavailable")?;
    window.set_size(tauri::LogicalSize::new(RESULT_WIDTH, RESULT_HEIGHT)).map_err(|error| error.to_string())?;
    // Keep the result inside the usable area after growing the window.
    if let (Ok(origin), Ok(scale)) = (window.outer_position(), window.scale_factor()) {
        let (x, y) = (origin.x as f64 / scale, origin.y as f64 / scale);
        if let Some(work) = work_area_at(&app, (x, y)) {
            let (left, top) = (work.x + EDGE_GAP, work.y + EDGE_GAP);
            let right = (work.x + work.width - EDGE_GAP - RESULT_WIDTH).max(left);
            let bottom = (work.y + work.height - EDGE_GAP - RESULT_HEIGHT).max(top);
            let _ = window.set_position(tauri::LogicalPosition::new(x.clamp(left, right), y.clamp(top, bottom)));
        }
    }
    app.state::<SelectionFloat>().expanded.store(true, Ordering::Relaxed);
    Ok(text)
}

#[tauri::command]
pub fn close_selection_float(app: AppHandle) { hide_selection_float(&app); }

#[cfg(target_os = "macos")]
fn selection_gesture(drag: f64, prior: Option<(std::time::Duration, f64)>) -> bool {
    const MIN_DRAG: f64 = 6.0;
    drag >= MIN_DRAG || (drag < MIN_DRAG && prior.is_some_and(|(elapsed, distance)| elapsed < std::time::Duration::from_millis(500) && distance < MIN_DRAG))
}

#[cfg(target_os = "macos")]
pub fn start_selection_monitor(app: AppHandle) {
    use std::{thread, time::{Duration, Instant}};
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" { fn CGEventSourceButtonState(state: i32, button: u32) -> bool; }
    const POLL: Duration = Duration::from_millis(40);
    const LIFETIME: Duration = Duration::from_secs(8);
    thread::spawn(move || {
        if let Ok(mut monitor) = app.state::<SelectionFloat>().monitor.lock() { *monitor = Some(thread::current()); }
        let mut down: Option<(f64, f64)> = None;
        let mut down_in_float = false;
        let mut visible_at: Option<Instant> = None;
        let mut previous_click: Option<(Instant, (f64, f64))> = None;
        // The text the float last came up for. Dragging a scroll bar or a window is a drag too,
        // and the selection it reads is the same: the float has already offered it.
        let mut last_shown: Option<String> = None;
        loop {
            thread::sleep(POLL);
            let enabled = app.state::<SelectionFloat>().enabled.load(Ordering::Relaxed);
            if !enabled || !accessibility::trusted() {
                if visible_at.is_some() { hide_selection_float(&app); }
                down = None; down_in_float = false; visible_at = None; previous_click = None; last_shown = None;
                // Off, it sleeps until `set_selection_float` turns it on; on without the permission it keeps looking.
                if !enabled { thread::park(); }
                continue;
            }
            let (Ok(cursor), Ok(Some(primary))) = (app.cursor_position(), app.primary_monitor()) else { continue };
            let point = (cursor.x / primary.scale_factor(), cursor.y / primary.scale_factor());
            let pressed = unsafe { CGEventSourceButtonState(0, 0) };
            if pressed {
                if down.is_none() {
                    down = Some(point);
                    down_in_float = app.get_webview_window("selection-float").is_some_and(|window| {
                        if !window.is_visible().unwrap_or(false) { return false; }
                        window.outer_position().ok().zip(window.scale_factor().ok()).is_some_and(|(origin, scale)| {
                            let (x, y) = (origin.x as f64 / scale, origin.y as f64 / scale);
                            let expanded = app.state::<SelectionFloat>().expanded.load(Ordering::Relaxed);
                            let (width, height) = if expanded { (RESULT_WIDTH, RESULT_HEIGHT) } else { (FLOAT_WIDTH, FLOAT_HEIGHT) };
                            point.0 >= x && point.0 <= x + width && point.1 >= y && point.1 <= y + height
                        })
                    });
                }
                continue;
            }
            if let Some(start) = down.take() {
                if down_in_float { down_in_float = false; previous_click = None; continue; }
                let distance = (point.0 - start.0).hypot(point.1 - start.1);
                let prior = previous_click.map(|(at, previous)| (at.elapsed(), (point.0 - previous.0).hypot(point.1 - previous.1)));
                if selection_gesture(distance, prior) {
                    // The click after a double click, a triple click selecting the paragraph, belongs to the same gesture.
                    previous_click = Some((Instant::now(), point));
                    let text = accessibility::selected();
                    if text.is_some() && text == last_shown { continue; }
                    hide_selection_float(&app);
                    visible_at = None;
                    last_shown = text.clone();
                    if let Some(text) = text {
                        if let Some(window) = app.get_webview_window("selection-float") {
                            let _ = window.set_size(tauri::LogicalSize::new(FLOAT_WIDTH, FLOAT_HEIGHT));
                            let (x, y) = work_area_at(&app, point)
                                .map(|work| float_spot(start, point, (FLOAT_WIDTH, FLOAT_HEIGHT), work))
                                .unwrap_or((point.0 + CURSOR_GAP.0, point.1 + CURSOR_GAP.1));
                            if let Ok(mut value) = app.state::<SelectionFloat>().text.lock() { *value = Some(text); }
                            let _ = window.emit("pet://selection-float-reset", ());
                            let _ = window.set_position(tauri::LogicalPosition::new(x, y));
                            let handle = window.clone();
                            let app_handle = app.clone();
                            let _ = app.run_on_main_thread(move || {
                                if app_handle.state::<SelectionFloat>().enabled.load(Ordering::Relaxed)
                                    && app_handle.state::<SelectionFloat>().text.lock().is_ok_and(|text| text.is_some()) {
                                    let _ = crate::floating_panel::show_without_focus(&handle);
                                }
                            });
                            visible_at = Some(Instant::now());
                        }
                    }
                } else if let Some(window) = app.get_webview_window("selection-float") {
                    previous_click = Some((Instant::now(), point));
                    // A plain click ends the selection: the same text selected again may come up again.
                    last_shown = None;
                    // Keep the button alive for its own click; the webview handles it.
                    let inside = window.outer_position().ok().zip(window.scale_factor().ok()).is_some_and(|(origin, scale)| {
                        let (x, y) = (origin.x as f64 / scale, origin.y as f64 / scale);
                        let expanded = app.state::<SelectionFloat>().expanded.load(Ordering::Relaxed);
                        let (width, height) = if expanded { (RESULT_WIDTH, RESULT_HEIGHT) } else { (FLOAT_WIDTH, FLOAT_HEIGHT) };
                        point.0 >= x && point.0 <= x + width && point.1 >= y && point.1 <= y + height
                    });
                    if !inside { hide_selection_float(&app); visible_at = None; }
                }
            }
            if !app.state::<SelectionFloat>().expanded.load(Ordering::Relaxed) && visible_at.is_some_and(|at| at.elapsed() >= LIFETIME) {
                // Gone on its own: selecting the same text again is asking for it again.
                hide_selection_float(&app); visible_at = None; last_shown = None;
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn start_selection_monitor(_app: AppHandle) {}

#[cfg(test)]
mod placement_tests {
    use super::{float_spot, CURSOR_GAP, EDGE_GAP, FLOAT_HEIGHT, FLOAT_WIDTH};
    use crate::Area;

    /// A screen with a 25px menu bar and a 70px Dock.
    const WORK: Area = Area { x: 0.0, y: 25.0, width: 1440.0, height: 805.0 };
    const SIZE: (f64, f64) = (FLOAT_WIDTH, FLOAT_HEIGHT);

    #[test]
    fn sits_below_and_right_of_where_the_selection_ended() {
        assert_eq!(float_spot((200.0, 300.0), (500.0, 300.0), SIZE, WORK), (500.0 + CURSOR_GAP.0, 300.0 + CURSOR_GAP.1));
    }

    #[test]
    fn goes_above_the_cursor_for_a_selection_made_upwards() {
        let (_, y) = float_spot((500.0, 400.0), (200.0, 300.0), SIZE, WORK);
        assert_eq!(y, 300.0 - CURSOR_GAP.1 - FLOAT_HEIGHT);
    }

    #[test]
    fn goes_above_the_cursor_when_there_is_no_room_below_instead_of_over_the_text() {
        let (_, y) = float_spot((200.0, 800.0), (500.0, 800.0), SIZE, WORK);
        assert_eq!(y, 800.0 - CURSOR_GAP.1 - FLOAT_HEIGHT);
    }

    #[test]
    fn keeps_off_the_menu_bar_and_the_screen_edge() {
        // Selected upwards to the first line: no room above, so below it, and never under the menu bar.
        let (x, y) = float_spot((1430.0, 60.0), (1430.0, 30.0), SIZE, WORK);
        assert_eq!(y, 30.0 + CURSOR_GAP.1);
        assert_eq!(x, 1440.0 - EDGE_GAP - FLOAT_WIDTH);
        let (_, y) = float_spot((200.0, 10.0), (200.0, 10.0), SIZE, WORK);
        assert_eq!(y, 25.0 + EDGE_GAP);
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::selection_gesture;
    use std::time::Duration;

    #[test]
    fn detects_selection_gestures_without_treating_single_clicks_as_selection() {
        assert!(selection_gesture(20.0, None));
        assert!(selection_gesture(0.0, Some((Duration::from_millis(250), 2.0))));
        assert!(!selection_gesture(0.0, None));
        assert!(!selection_gesture(0.0, Some((Duration::from_millis(600), 2.0))));
        assert!(!selection_gesture(0.0, Some((Duration::from_millis(250), 20.0))));
    }
}
