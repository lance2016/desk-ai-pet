//! What the user hands the pet when calling it up: the text selected in the app in
//! front, or else what was just copied. Both are read only at that moment. Between
//! calls the clipboard is watched by its change count alone, never its content.

use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

/// Something copied this recently counts as handed over. The settings footnote says "1 分钟".
const RECENT_COPY: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_secs(1);
/// Characters passed to the page at most; the page keeps fewer.
const MAX_CHARS: usize = 16_000;

/// The clipboard's change count as last seen, and when it last changed while another app was in front.
#[derive(Default)]
pub struct Clipboard(Mutex<Watch>);

#[derive(Default)]
struct Watch {
    count: Option<isize>,
    changed_at: Option<Instant>,
}

impl Watch {
    /// A new count. The first one only sets the baseline; a copy made in the pet's own windows does not count.
    fn saw(&mut self, count: isize, own_app_in_front: bool, now: Instant) {
        let changed = self.count.is_some_and(|seen| seen != count);
        self.count = Some(count);
        if changed {
            self.changed_at = if own_app_in_front { None } else { Some(now) };
        }
    }

    /// Whether a copy is recent enough to offer; offering it uses it up.
    fn take_recent(&mut self, now: Instant) -> bool {
        let recent = self.changed_at.is_some_and(|at| now.duration_since(at) <= RECENT_COPY);
        self.changed_at = None;
        recent
    }
}

#[cfg(target_os = "macos")]
mod pasteboard {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSPasteboard, NSPasteboardTypeString};

    pub fn change_count() -> isize {
        NSPasteboard::generalPasteboard().changeCount()
    }

    pub fn own_app_in_front(main_thread: MainThreadMarker) -> bool {
        NSApplication::sharedApplication(main_thread).isActive()
    }

    /// Reads the content: the one call that may make macOS ask the user, so it happens only when they call the pet.
    pub fn text() -> Option<String> {
        NSPasteboard::generalPasteboard().stringForType(unsafe { NSPasteboardTypeString }).map(|text| text.to_string())
    }
}

/// Watches the clipboard's change count, once a second, on the main thread as AppKit expects.
#[cfg(target_os = "macos")]
pub fn start_watch(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL);
        let handle = app.clone();
        let polled = app.run_on_main_thread(move || {
            let Some(main_thread) = objc2::MainThreadMarker::new() else { return };
            let count = pasteboard::change_count();
            let in_front = pasteboard::own_app_in_front(main_thread);
            if let Ok(mut watch) = handle.state::<Clipboard>().0.lock() {
                watch.saw(count, in_front, Instant::now());
            }
        });
        if polled.is_err() {
            return;
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn start_watch(_app: AppHandle) {}

fn clipped(text: String) -> Option<String> {
    if text.trim().is_empty() {
        return None;
    }
    Some(match text.char_indices().nth(MAX_CHARS) {
        Some((end, _)) => text[..end].to_string(),
        None => text,
    })
}

/// What to put in the quick chat bar as it opens: `{ text, source }`, or null.
/// `clipboard`: the user lets the pet look at what was just copied.
#[tauri::command]
pub fn take_handover(state: State<'_, Clipboard>, clipboard: bool) -> Value {
    #[cfg(target_os = "macos")]
    {
        if let Some(text) = crate::translation::selected_text().and_then(clipped) {
            return json!({ "text": text, "source": "selection" });
        }
        let recent = state.0.lock().map(|mut watch| watch.take_recent(Instant::now())).unwrap_or(false);
        if clipboard && recent {
            if let Some(text) = pasteboard::text().and_then(clipped) {
                return json!({ "text": text, "source": "clipboard" });
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (state, clipboard);
    Value::Null
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_a_copy_from_another_app_until_it_is_offered() {
        let start = Instant::now();
        let mut watch = Watch::default();
        watch.saw(1, false, start);
        assert!(!watch.take_recent(start), "the first count is only the baseline");
        watch.saw(2, false, start);
        assert!(watch.take_recent(start + Duration::from_secs(30)));
        assert!(!watch.take_recent(start + Duration::from_secs(31)), "offered once");
    }

    #[test]
    fn ignores_old_copies_and_the_pets_own() {
        let start = Instant::now();
        let mut watch = Watch::default();
        watch.saw(1, false, start);
        watch.saw(2, false, start);
        assert!(!watch.take_recent(start + RECENT_COPY + Duration::from_secs(1)));
        watch.saw(3, true, start);
        assert!(!watch.take_recent(start));
    }

    #[test]
    fn keeps_at_most_the_limit() {
        assert_eq!(clipped("  ".into()), None);
        assert_eq!(clipped("字".repeat(MAX_CHARS + 5)).map(|text| text.chars().count()), Some(MAX_CHARS));
    }
}
