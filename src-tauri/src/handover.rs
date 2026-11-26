//! Text the user hands the pet by copying it. Between uses the clipboard is watched by its
//! change count and its kinds of data alone, never its content: a copy only lights up the chat
//! button, and the content is read when the user clicks it, or presses the translation shortcut
//! with no selection to read. That shortcut may also copy for the user (`copy_from_front`).

use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

/// Something copied this recently can still be handed over. Must match `COPY_HINT_MS` in `src/components/QuickChat.tsx`.
const RECENT_COPY: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_secs(1);
/// Characters passed to the page at most; the page keeps fewer.
const MAX_CHARS: usize = 16_000;
/// How long the app in front gets to put the ⌘C pressed for the user on the clipboard.
const COPY_WAIT: Duration = Duration::from_millis(400);
const COPY_POLL: Duration = Duration::from_millis(10);
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

    /// Whether a copy is recent enough to hand over.
    fn recent(&self, now: Instant) -> bool {
        self.changed_at.is_some_and(|at| now.duration_since(at) <= RECENT_COPY)
    }

    /// Whether a copy is recent enough to hand over; handing it over uses it up.
    fn take_recent(&mut self, now: Instant) -> bool {
        let recent = self.recent(now);
        self.changed_at = None;
        recent
    }
}

#[cfg(target_os = "macos")]
mod pasteboard {
    use objc2::{MainThreadMarker, rc::Retained, runtime::ProtocolObject};
    use objc2_app_kit::{NSApplication, NSPasteboard, NSPasteboardItem, NSPasteboardTypeString};
    use objc2_foundation::NSArray;

    /// What was on the clipboard, every kind of data of every item, to put back.
    pub struct Saved(Vec<Retained<NSPasteboardItem>>);

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

    /// Reads the content: the one call that may make macOS ask the user, so it happens only when they ask.
    pub fn text() -> Option<String> {
        NSPasteboard::generalPasteboard().stringForType(unsafe { NSPasteboardTypeString }).map(|text| text.to_string())
    }

    /// Copies what is on the clipboard without looking at it, to put back with `restore`.
    pub fn save() -> Saved {
        let items = NSPasteboard::generalPasteboard().pasteboardItems().map(|items| items.to_vec()).unwrap_or_default();
        Saved(items.iter().map(|item| {
            let copy = NSPasteboardItem::new();
            for kind in item.types().iter() {
                if let Some(data) = item.dataForType(&kind) {
                    copy.setData_forType(&data, &kind);
                }
            }
            copy
        }).collect())
    }

    pub fn restore(saved: Saved) {
        let board = NSPasteboard::generalPasteboard();
        board.clearContents();
        if saved.0.is_empty() {
            return;
        }
        let items: Vec<_> = saved.0.into_iter().map(ProtocolObject::from_retained).collect();
        if !board.writeObjects(&NSArray::from_retained_slice(&items)) {
            log::warn!("could not put the clipboard back after copying the selection");
        }
    }
}

/// Presses ⌘C in an app, as the user would.
#[cfg(target_os = "macos")]
mod keys {
    use std::ffi::c_void;
    type CF = *const c_void;
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceCreate(state: i32) -> CF;
        fn CGEventCreateKeyboardEvent(source: CF, key: u16, down: bool) -> CF;
        fn CGEventSetFlags(event: CF, flags: u64);
        fn CGEventPostToPid(pid: i32, event: CF);
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(value: CF);
    }
    /// A source of its own, so the keys the user still holds (the shortcut's) do not mix in.
    const PRIVATE_STATE: i32 = -1;
    const KEY_C: u16 = 8;
    const COMMAND: u64 = 0x0010_0000;

    /// Sent to the app itself, not to the key window: a pet panel holding the keyboard must not get it.
    pub fn press_copy(pid: i32) -> bool {
        // SAFETY: every event and the source are released once, after their last use.
        unsafe {
            let source = CGEventSourceCreate(PRIVATE_STATE);
            if source.is_null() {
                return false;
            }
            for down in [true, false] {
                let event = CGEventCreateKeyboardEvent(source, KEY_C, down);
                if event.is_null() {
                    CFRelease(source);
                    return false;
                }
                CGEventSetFlags(event, COMMAND);
                CGEventPostToPid(pid, event);
                CFRelease(event);
            }
            CFRelease(source);
            true
        }
    }
}

/// Watches the clipboard once a second, on the main thread as AppKit expects.
#[cfg(target_os = "macos")]
pub fn start_watch(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(POLL);
        let handle = app.clone();
        let polled = app.run_on_main_thread(move || look(&handle));
        if polled.is_err() {
            return;
        }
    });
}

/// Brings the watch up to date with the clipboard and tells the pet about a new copy.
/// Does nothing off the main thread.
#[cfg(target_os = "macos")]
fn look(app: &AppHandle) {
    let Some(main_thread) = objc2::MainThreadMarker::new() else { return };
    let count = pasteboard::change_count();
    let clipboard = app.state::<Clipboard>();
    let Ok(mut watch) = clipboard.0.lock() else { return };
    if watch.count == Some(count) {
        return;
    }
    let worth_offering = !pasteboard::own_app_in_front(main_thread) && !pasteboard::is_private();
    if watch.saw(count, worth_offering, Instant::now()) {
        if let Err(error) = app.emit_to(crate::MAIN_WINDOW, COPIED_EVENT, ()) {
            log::warn!("failed to tell the pet about a copy: {error}");
        }
    }
}

/// Copies the selection in the app `pid` by pressing ⌘C for the user, for apps whose selection
/// accessibility cannot read (Chrome, Electron apps, WeChat), and puts the clipboard back as it was.
/// None when nothing was copied in `COPY_WAIT`. Must be called on the main thread: the watch runs
/// there too, so it never sees the copy, and it takes the clipboard put back as already seen.
#[cfg(target_os = "macos")]
pub fn copy_from_front(app: &AppHandle, pid: i32) -> Option<String> {
    // A copy the watch has not seen yet stays the user's: it is recorded before the clipboard moves.
    look(app);
    let before = pasteboard::change_count();
    let saved = pasteboard::save();
    if !keys::press_copy(pid) {
        return None;
    }
    let deadline = Instant::now() + COPY_WAIT;
    let mut text = None;
    while text.is_none() && Instant::now() < deadline {
        std::thread::sleep(COPY_POLL);
        // An app clears the clipboard before writing to it: wait for the text, not just the change.
        if pasteboard::change_count() != before {
            text = pasteboard::text();
        }
    }
    if pasteboard::change_count() != before {
        pasteboard::restore(saved);
        if let Ok(mut watch) = app.state::<Clipboard>().0.lock() {
            watch.count = Some(pasteboard::change_count());
        }
    }
    text.and_then(clipped)
}

/// The text copied in the last minute, for the translation shortcut that found no selection to
/// read: a program that draws its own selection (Claude Code in a terminal) can still copy on
/// select. The copy is not used up, the chat button may take it too. Looks first, as the watch
/// may be a second behind. Must be called on the main thread.
#[cfg(target_os = "macos")]
pub fn recent_copy(app: &AppHandle) -> Option<String> {
    look(app);
    let recent = app.state::<Clipboard>().0.lock().is_ok_and(|watch| watch.recent(Instant::now()));
    if recent { pasteboard::text().and_then(clipped) } else { None }
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
    fn a_recent_copy_can_be_read_without_using_it_up() {
        let start = Instant::now();
        let mut watch = Watch::default();
        watch.saw(1, true, start);
        watch.saw(2, true, start);
        assert!(watch.recent(start + Duration::from_secs(30)));
        assert!(watch.recent(start + Duration::from_secs(31)), "still there for the chat button");
        assert!(!watch.recent(start + RECENT_COPY + Duration::from_secs(1)));
        assert!(watch.take_recent(start + Duration::from_secs(32)));
        assert!(!watch.recent(start + Duration::from_secs(33)));
    }

    #[test]
    fn keeps_at_most_the_limit() {
        assert_eq!(clipped("  ".into()), None);
        assert_eq!(clipped("字".repeat(MAX_CHARS + 5)).map(|text| text.chars().count()), Some(MAX_CHARS));
    }
}
