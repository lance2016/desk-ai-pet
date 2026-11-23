//! A short ring around the terminal the user was just taken to, so that split stands out among the others.
//!
//! Ghostty's scripting places a terminal by window and tab, not on screen. Its focused surface can be read
//! through the accessibility API, which AI Pet already holds for selection translation; without that
//! permission nothing is drawn and nothing is asked. The ring is a borderless panel of its own that takes
//! no clicks and no focus: faded in, held, faded out. A new ring takes over from one still showing.
//!
//! Ghostty comes forward after the script that focused the terminal has returned (`activate` does not
//! wait), sometimes switching spaces on the way. Read at once, its focused element is still the old
//! window's, or the app itself; so the ring waits until Ghostty is the frontmost app and its focused
//! terminal has stopped moving.

use std::cell::RefCell;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use objc2::{rc::Retained, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSAnimatablePropertyContainer, NSAnimationContext, NSBackingStoreType, NSBox, NSBoxType, NSColor, NSPanel,
    NSRunningApplication, NSScreen, NSStatusWindowLevel, NSTitlePosition, NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use tauri::AppHandle;

const FADE_IN: Duration = Duration::from_millis(150);
const HOLD: Duration = Duration::from_millis(900);
const FADE_OUT: Duration = Duration::from_millis(450);
const RING_WIDTH: f64 = 4.0;
const RING_RADIUS: f64 = 8.0;
/// A focused element smaller than this is not a terminal worth ringing.
const MIN_SIDE: f64 = 40.0;
/// How often, and for how long, to look for the terminal to settle in front.
const SETTLE_POLL: Duration = Duration::from_millis(100);
const SETTLE_WITHIN: Duration = Duration::from_secs(2);

/// Bumped by every ring, so the steps of one that was taken over do nothing.
static GENERATION: AtomicU64 = AtomicU64::new(0);

thread_local! {
    /// Made on first use and kept, on the main thread where AppKit wants it.
    static RING: RefCell<Option<Retained<NSPanel>>> = const { RefCell::new(None) };
}

/// Where a terminal is, in points from the top left of the main screen, as accessibility reports it.
#[derive(Clone, Copy, PartialEq)]
struct Frame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Rings the focused element of the app with this bundle identifier once it is in front. Called after that
/// app was asked to come forward; returns at once and waits on a thread of its own.
pub fn flash(app: &AppHandle, bundle_id: &str) {
    if !accessibility::trusted() {
        return;
    }
    let Some(pid) = pid_of(bundle_id) else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        let Some(frame) = settled_frame(pid) else {
            log::warn!("The terminal did not settle in front in time; not ringing it");
            return;
        };
        let generation = GENERATION.fetch_add(1, Ordering::Relaxed) + 1;
        report(app.run_on_main_thread(move || show(frame)));
        std::thread::sleep(FADE_IN + HOLD);
        report(app.run_on_main_thread(move || if current(generation) { with_ring(|ring| fade(ring, 0.0, FADE_OUT)) }));
        std::thread::sleep(FADE_OUT);
        report(app.run_on_main_thread(move || if current(generation) { with_ring(|ring| ring.orderOut(None)) }));
    });
}

/// The app's focused terminal once the app is frontmost and the terminal is where it was a poll ago; None if that takes too long.
fn settled_frame(pid: i32) -> Option<Frame> {
    let deadline = Instant::now() + SETTLE_WITHIN;
    let mut last = None;
    while Instant::now() < deadline {
        let frame = (accessibility::frontmost_pid() == Some(pid))
            .then(|| accessibility::focused_frame(pid))
            .flatten()
            .filter(|frame| frame.width >= MIN_SIDE && frame.height >= MIN_SIDE);
        if frame.is_some() && frame == last {
            return frame;
        }
        last = frame;
        std::thread::sleep(SETTLE_POLL);
    }
    None
}

fn current(generation: u64) -> bool {
    GENERATION.load(Ordering::Relaxed) == generation
}

fn report(result: tauri::Result<()>) {
    if let Err(error) = result {
        log::warn!("Could not ring the terminal: {error}");
    }
}

fn pid_of(bundle_id: &str) -> Option<i32> {
    NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(bundle_id))
        .firstObject()
        .map(|app| app.processIdentifier())
}

fn with_ring(action: impl FnOnce(&NSPanel)) {
    RING.with(|cell| {
        if let Some(ring) = cell.borrow().as_deref() {
            action(ring);
        }
    });
}

fn show(frame: Frame) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    // Accessibility counts down from the top of the main screen, AppKit up from its bottom.
    let Some(main) = NSScreen::screens(mtm).firstObject() else { return };
    let bottom = main.frame().size.height - frame.y - frame.height;
    let rect = NSRect::new(NSPoint::new(frame.x, bottom), NSSize::new(frame.width, frame.height));
    RING.with(|cell| {
        let mut slot = cell.borrow_mut();
        let ring = slot.get_or_insert_with(|| make_ring(mtm));
        ring.setFrame_display(rect, false);
        ring.setAlphaValue(0.0);
        ring.orderFrontRegardless();
        fade(ring, 1.0, FADE_IN);
    });
}

fn fade(ring: &NSPanel, alpha: f64, over: Duration) {
    NSAnimationContext::beginGrouping();
    NSAnimationContext::currentContext().setDuration(over.as_secs_f64());
    ring.animator().setAlphaValue(alpha);
    NSAnimationContext::endGrouping();
}

/// A see-through panel above other apps, on whichever space is showing, full-screen ones included.
/// The ring is drawn inside the terminal's frame, in the system accent color, so it never covers a neighbor.
fn make_ring(mtm: MainThreadMarker) -> Retained<NSPanel> {
    let style = NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel;
    // SAFETY: a fresh panel with a valid style and backing; it is kept, so it must not release itself on close.
    let ring = unsafe {
        let ring = NSPanel::initWithContentRect_styleMask_backing_defer(NSPanel::alloc(mtm), NSRect::ZERO, style, NSBackingStoreType::Buffered, false);
        ring.setReleasedWhenClosed(false);
        ring
    };
    ring.setOpaque(false);
    ring.setBackgroundColor(Some(&NSColor::clearColor()));
    ring.setHasShadow(false);
    ring.setIgnoresMouseEvents(true);
    ring.setLevel(NSStatusWindowLevel);
    ring.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Transient
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    let outline = NSBox::new(mtm);
    outline.setBoxType(NSBoxType::Custom);
    outline.setTitlePosition(NSTitlePosition::NoTitle);
    outline.setBorderWidth(RING_WIDTH);
    outline.setCornerRadius(RING_RADIUS);
    outline.setBorderColor(&NSColor::controlAccentColor());
    outline.setFillColor(&NSColor::clearColor());
    ring.setContentView(Some(&outline));
    ring
}

mod accessibility {
    use super::Frame;
    use std::ffi::{c_char, c_void, CStr};
    use std::ptr;

    type CF = *const c_void;
    /// A CGPoint or a CGSize.
    #[repr(C)]
    #[derive(Default)]
    struct Pair(f64, f64);

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXUIElementCreateApplication(pid: i32) -> CF;
        fn AXUIElementCreateSystemWide() -> CF;
        fn AXUIElementGetPid(element: CF, pid: *mut i32) -> i32;
        fn AXUIElementCopyAttributeValue(element: CF, attribute: CF, value: *mut CF) -> i32;
        fn AXValueGetValue(value: CF, kind: u32, out: *mut c_void) -> bool;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFRelease(value: CF);
        fn CFEqual(a: CF, b: CF) -> bool;
        fn CFStringCreateWithCString(alloc: CF, text: *const c_char, encoding: u32) -> CF;
    }
    const UTF8: u32 = 0x0800_0100;
    const CG_POINT: u32 = 1;
    const CG_SIZE: u32 = 2;
    /// What a Ghostty terminal is to accessibility (1.4, not documented). For a few seconds after a window
    /// opens or closes Ghostty answers with the app itself, which has a frame too: that is not ringed.
    const TERMINAL_ROLE: &CStr = c"AXTextArea";

    /// Whether AI Pet holds the accessibility permission. Never asks for it.
    pub(super) fn trusted() -> bool {
        unsafe { AXIsProcessTrusted() }
    }

    /// The process of the app in front, as accessibility sees it now. Read live: AppKit's own answer
    /// is only brought up to date on the main thread.
    pub(super) fn frontmost_pid() -> Option<i32> {
        // SAFETY: the system-wide element and the copied app are released once, and only read while held.
        unsafe {
            let system = AXUIElementCreateSystemWide();
            if system.is_null() {
                return None;
            }
            let front = attribute(system, c"AXFocusedApplication");
            CFRelease(system);
            let front = front?;
            let mut pid = 0;
            let result = AXUIElementGetPid(front, &mut pid);
            CFRelease(front);
            (result == 0).then_some(pid)
        }
    }

    /// The app's focused element on screen; None without the accessibility permission.
    pub(super) fn focused_frame(pid: i32) -> Option<Frame> {
        if !trusted() {
            return None;
        }
        // SAFETY: every CF object created or copied here is released once, and only read while held.
        unsafe {
            let app = AXUIElementCreateApplication(pid);
            if app.is_null() {
                return None;
            }
            let focused = attribute(app, c"AXFocusedUIElement");
            CFRelease(app);
            let focused = focused?;
            if !has_role(focused, TERMINAL_ROLE) {
                CFRelease(focused);
                return None;
            }
            let origin = pair(focused, c"AXPosition", CG_POINT);
            let size = pair(focused, c"AXSize", CG_SIZE);
            CFRelease(focused);
            let (Pair(x, y), Pair(width, height)) = (origin?, size?);
            Some(Frame { x, y, width, height })
        }
    }

    unsafe fn attribute(element: CF, name: &CStr) -> Option<CF> {
        let key = unsafe { CFStringCreateWithCString(ptr::null(), name.as_ptr(), UTF8) };
        if key.is_null() {
            return None;
        }
        let mut value = ptr::null();
        let result = unsafe { AXUIElementCopyAttributeValue(element, key, &mut value) };
        unsafe { CFRelease(key) };
        (result == 0 && !value.is_null()).then_some(value)
    }

    unsafe fn has_role(element: CF, role: &CStr) -> bool {
        let Some(value) = (unsafe { attribute(element, c"AXRole") }) else { return false };
        let wanted = unsafe { CFStringCreateWithCString(ptr::null(), role.as_ptr(), UTF8) };
        let same = !wanted.is_null() && unsafe { CFEqual(value, wanted) };
        unsafe { CFRelease(value) };
        if !wanted.is_null() {
            unsafe { CFRelease(wanted) };
        }
        same
    }

    unsafe fn pair(element: CF, name: &CStr, kind: u32) -> Option<Pair> {
        let value = unsafe { attribute(element, name) }?;
        let mut out = Pair::default();
        let read = unsafe { AXValueGetValue(value, kind, (&mut out as *mut Pair).cast()) };
        unsafe { CFRelease(value) };
        read.then_some(out)
    }
}
