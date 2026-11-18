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
}

/// Must match the `selection-float` window width in `tauri.conf.json`.
const FLOAT_WIDTH: f64 = 216.0;
const FLOAT_HEIGHT: f64 = 38.0;
const RESULT_WIDTH: f64 = 340.0;
const RESULT_HEIGHT: f64 = 220.0;

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
            let focused = attribute(system, c"AXFocusedUIElement");
            CFRelease(system);
            let focused = focused?;
            let mut pid = 0;
            if AXUIElementGetPid(focused, &mut pid) != 0 || pid == std::process::id() as i32 {
                CFRelease(focused);
                return None;
            }
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

fn show_selection(app: &AppHandle, text: Option<String>, auto: bool, result: Option<String>) {
    let status = if !selection_status() { "permission" } else if text.is_none() { "empty" } else { "ok" };
    if let Ok(mut state) = app.state::<Selection>().0.lock() { *state = json!({"text": text.unwrap_or_default(), "status": status, "auto": auto, "result": result.unwrap_or_default()}); }
    if let Some(window) = app.get_webview_window("translation") {
        let _ = window.emit("pet://translation-open", ());
        #[cfg(target_os = "macos")]
        if let Err(error) = crate::floating_panel::take_keyboard(&window) { eprintln!("failed to show translation: {error}"); }
        #[cfg(not(target_os = "macos"))]
        { let _ = window.show(); let _ = window.set_focus(); }
    }
}

#[tauri::command]
pub fn selection_status() -> bool {
    #[cfg(target_os = "macos")]
    return accessibility::trusted();
    #[cfg(not(target_os = "macos"))]
    false
}

pub fn open(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    let text = accessibility::selected();
    #[cfg(not(target_os = "macos"))]
    let text: Option<String> = None;
    hide_selection_float(app);
    show_selection(app, text, false, None);
}

#[tauri::command]
pub fn open_translation(app: AppHandle) { open(&app); }

#[tauri::command]
pub fn take_translation_selection(state: State<'_, Selection>) -> Value {
    state.0.lock().map(|mut value| std::mem::take(&mut *value)).unwrap_or(Value::Null)
}

fn hide_selection_float(app: &AppHandle) {
    app.state::<SelectionFloat>().expanded.store(false, Ordering::Relaxed);
    if let Ok(mut text) = app.state::<SelectionFloat>().text.lock() { *text = None; }
    if let Some(state) = app.try_state::<std::sync::Arc<crate::chat::ChatState>>() { state.cancel_window("selection-float"); }
    if let Some(window) = app.get_webview_window("selection-float") { let _ = window.hide(); }
}

#[tauri::command]
pub fn set_selection_float(app: AppHandle, enabled: bool) {
    app.state::<SelectionFloat>().enabled.store(enabled, Ordering::Relaxed);
    if !enabled { hide_selection_float(&app); }
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
    // Keep the result inside the current monitor after growing the window.
    if let (Ok(origin), Ok(scale), Ok(monitors)) = (window.outer_position(), window.scale_factor(), app.available_monitors()) {
        let (x, y) = (origin.x as f64 / scale, origin.y as f64 / scale);
        if let Some(monitor) = monitors.iter().find(|monitor| {
            let scale = monitor.scale_factor();
            let (left, top) = (monitor.position().x as f64 / scale, monitor.position().y as f64 / scale);
            x >= left && x < left + monitor.size().width as f64 / scale && y >= top && y < top + monitor.size().height as f64 / scale
        }) {
            let monitor_scale = monitor.scale_factor();
            let (left, top) = (monitor.position().x as f64 / monitor_scale, monitor.position().y as f64 / monitor_scale);
            let (right, bottom) = (left + monitor.size().width as f64 / monitor_scale, top + monitor.size().height as f64 / monitor_scale);
            let _ = window.set_position(tauri::LogicalPosition::new(x.clamp(left, (right - RESULT_WIDTH).max(left)), y.clamp(top, (bottom - RESULT_HEIGHT).max(top))));
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
        let mut down: Option<(f64, f64)> = None;
        let mut down_in_float = false;
        let mut visible_at: Option<Instant> = None;
        let mut previous_click: Option<(Instant, (f64, f64))> = None;
        loop {
            thread::sleep(POLL);
            if !app.state::<SelectionFloat>().enabled.load(Ordering::Relaxed) || !accessibility::trusted() {
                if visible_at.is_some() { hide_selection_float(&app); }
                down = None; down_in_float = false; visible_at = None; previous_click = None; continue;
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
                    previous_click = None;
                    hide_selection_float(&app);
                    visible_at = None;
                    if let Some(text) = accessibility::selected() {
                        if let Some(window) = app.get_webview_window("selection-float") {
                            let _ = window.set_size(tauri::LogicalSize::new(FLOAT_WIDTH, FLOAT_HEIGHT));
                            let mut x = point.0 + 10.0;
                            let mut y = point.1 + 12.0;
                            if let Ok(monitors) = app.available_monitors() {
                                if let Some(monitor) = monitors.iter().find(|monitor| {
                                    let scale = monitor.scale_factor(); let origin = monitor.position(); let size = monitor.size();
                                    let (left, top) = (origin.x as f64 / scale, origin.y as f64 / scale);
                                    point.0 >= left && point.0 < left + size.width as f64 / scale && point.1 >= top && point.1 < top + size.height as f64 / scale
                                }) {
                                    let scale = monitor.scale_factor(); let origin = monitor.position(); let size = monitor.size();
                                    let (left, top) = (origin.x as f64 / scale, origin.y as f64 / scale);
                                    x = x.clamp(left, (left + size.width as f64 / scale - FLOAT_WIDTH).max(left));
                                    y = y.clamp(top, (top + size.height as f64 / scale - FLOAT_HEIGHT).max(top));
                                }
                            }
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
                hide_selection_float(&app); visible_at = None;
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn start_selection_monitor(_app: AppHandle) {}

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
