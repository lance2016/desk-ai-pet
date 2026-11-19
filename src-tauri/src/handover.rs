//! Text the user hands the pet by copying it. Between uses the clipboard is watched by its
//! change count and its kinds of data alone, never its content: a copy only lights up the chat
//! button, and the content is read when the user clicks it.

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

/// Something copied this recently can still be handed over. Must match `COPY_HINT_MS` in `src/components/QuickChat.tsx`.
const RECENT_COPY: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_secs(1);
/// Characters passed to the page at most; the page keeps fewer.
const MAX_CHARS: usize = 16_000;
/// Tells the pet window something was copied in another app. Must match `src/platform/handover.ts`.
const COPIED_EVENT: &str = "pet://copied";
/// Kinds of data password managers add to what they copy (nspasteboard.org); such copies are left alone.
#[cfg(target_os = "macos")]
const PRIVATE_TYPES: [&str; 2] = ["org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType"];

/// The clipboard's change count as last seen, and when it last changed with something worth offering.
#[derive(Default)]
pub struct Clipboard(Mutex<Watch>);

#[derive(Default)]
struct Watch {
    count: Option<isize>,
    changed_at: Option<Instant>,
}

impl Watch {
    /// A new count; true when it is a copy worth offering. The first count only sets the baseline, and
    /// a copy made in the pet's own windows or by a password manager does not count.
    fn saw(&mut self, count: isize, worth_offering: bool, now: Instant) -> bool {
        let changed = self.count.is_some_and(|seen| seen != count);
        self.count = Some(count);
        if !changed {
            return false;
        }
        self.changed_at = worth_offering.then_some(now);
        worth_offering
    }

    /// Whether a copy is recent enough to hand over; handing it over uses it up.
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

    /// Whether the copy is marked private. Reads only the kinds of data, not the data.
    pub fn is_private() -> bool {
        let Some(types) = NSPasteboard::generalPasteboard().types() else { return false };
        types.iter().any(|kind| super::PRIVATE_TYPES.contains(&kind.to_string().as_str()))
    }

    /// Reads the content: the one call that may make macOS ask the user, so it happens only on their click.
    pub fn text() -> Option<String> {
        NSPasteboard::generalPasteboard().stringForType(unsafe { NSPasteboardTypeString }).map(|text| text.to_string())
    }
}

/// Watches the clipboard once a second, on the main thread as AppKit expects.
#[cfg(target_os = "macos")]
pub fn start_watch(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL);
        let handle = app.clone();
        let polled = app.run_on_main_thread(move || {
            let Some(main_thread) = objc2::MainThreadMarker::new() else { return };
            let count = pasteboard::change_count();
            let clipboard = handle.state::<Clipboard>();
            let Ok(mut watch) = clipboard.0.lock() else { return };
            if watch.count == Some(count) {
                return;
            }
            let worth_offering = !pasteboard::own_app_in_front(main_thread) && !pasteboard::is_private();
            if watch.saw(count, worth_offering, Instant::now()) {
                if let Err(error) = handle.emit_to(crate::MAIN_WINDOW, COPIED_EVENT, ()) {
                    log::warn!("failed to tell the pet about a copy: {error}");
                }
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

/// The text copied in the last minute, read now that the user asked for it; None when there is none.
#[tauri::command]
pub fn take_copied(state: State<'_, Clipboard>) -> Option<String> {
    let recent = state.0.lock().map(|mut watch| watch.take_recent(Instant::now())).unwrap_or(false);
    #[cfg(target_os = "macos")]
    if recent {
        return pasteboard::text().and_then(clipped);
    }
    let _ = recent;
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offers_a_copy_from_another_app_once() {
        let start = Instant::now();
        let mut watch = Watch::default();
        assert!(!watch.saw(1, true, start), "the first count is only the baseline");
        assert!(!watch.take_recent(start));
        assert!(watch.saw(2, true, start));
        assert!(watch.take_recent(start + Duration::from_secs(30)));
        assert!(!watch.take_recent(start + Duration::from_secs(31)), "handed over once");
    }

    #[test]
    fn leaves_out_old_copies_and_ones_not_worth_offering() {
        let start = Instant::now();
        let mut watch = Watch::default();
        watch.saw(1, true, start);
        watch.saw(2, true, start);
        assert!(!watch.take_recent(start + RECENT_COPY + Duration::from_secs(1)));
        assert!(!watch.saw(3, false, start));
        assert!(!watch.take_recent(start));
    }

    #[test]
    fn keeps_at_most_the_limit() {
        assert_eq!(clipped("  ".into()), None);
        assert_eq!(clipped("字".repeat(MAX_CHARS + 5)).map(|text| text.chars().count()), Some(MAX_CHARS));
    }
}
