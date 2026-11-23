//! Makes the pet window float above everything, including full-screen apps.
//!
//! macOS only lets *panels* that do not activate their app appear on another
//! app's full-screen space. Tauri creates an ordinary window, so it is turned
//! into a panel after creation.

use std::{ptr::NonNull, rc::Rc};

use block2::RcBlock;
use objc2::{ClassType, MainThreadOnly, define_class, ffi, runtime::AnyObject};
use objc2_app_kit::{
    NSEvent, NSEventMask, NSNormalWindowLevel, NSPanel, NSResponder, NSStatusWindowLevel, NSWindow,
    NSWindowCollectionBehavior, NSWindowStyleMask,
};
use tauri::WebviewWindow;

define_class!(
    // SAFETY: NSPanel may be subclassed freely, and this subclass adds no state.
    #[unsafe(super(NSPanel))]
    #[thread_kind = MainThreadOnly]
    #[name = "PetPanel"]
    struct PetPanel;

    impl PetPanel {
        /// A borderless panel refuses keyboard focus by default, which would
        /// leave the buttons in the webview without focus handling.
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool {
            true
        }
    }
);

/// Must be called on the main thread, before the window is first shown.
pub fn apply(window: &WebviewWindow) -> tauri::Result<()> {
    make_panel(
        window,
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::FullScreenAuxiliary,
    )?;
    set_on_top(window, true)
}

/// Turns a popover (reminders, notes) into a panel that opens on the space
/// the user is in, full-screen ones included, without activating the app: an
/// ordinary window would pull the user out of a full-screen app. It sits at
/// the pet's level so it opens above it. Show it with `take_keyboard`.
/// Must be called on the main thread, before the window is first shown.
pub fn apply_popover(window: &WebviewWindow) -> tauri::Result<()> {
    make_panel(
        window,
        NSWindowCollectionBehavior::MoveToActiveSpace | NSWindowCollectionBehavior::FullScreenAuxiliary,
    )?;
    set_on_top(window, true)
}

fn make_panel(window: &WebviewWindow, behavior: NSWindowCollectionBehavior) -> tauri::Result<()> {
    let ns_window = window.ns_window()?.cast::<NSWindow>();
    // SAFETY: Tauri hands out a valid NSWindow pointer that outlives this call.
    // PetPanel adds no instance variables, so the existing object can take it
    // as its class; from then on it behaves as an NSPanel.
    unsafe {
        ffi::object_setClass(
            ns_window.cast::<AnyObject>(),
            (PetPanel::class() as *const objc2::runtime::AnyClass).cast(),
        );
        let panel = &*ns_window;
        panel.setStyleMask(panel.styleMask() | NSWindowStyleMask::NonactivatingPanel);
        panel.setCollectionBehavior(behavior);
    }
    Ok(())
}

/// Raises the pet above other windows, or lets it mix with them again.
/// Must be called on the main thread.
pub fn set_on_top(window: &WebviewWindow, on_top: bool) -> tauri::Result<()> {
    let ns_window = window.ns_window()?.cast::<NSWindow>();
    // The ordinary "always on top" level sits below full-screen windows, so the
    // status level is used instead.
    let level = if on_top {
        NSStatusWindowLevel
    } else {
        NSNormalWindowLevel
    };
    // SAFETY: Tauri hands out a valid NSWindow pointer that outlives this call.
    unsafe { (*ns_window).setLevel(level) };
    Ok(())
}

/// Gives the pet keyboard focus for the quick chat bar. The panel does not
/// activate the app, so the app the user was in stays in front.
/// Must be called on the main thread.
pub fn take_keyboard(window: &WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|webview| {
        // SAFETY: both pointers come from Tauri and are valid on the main
        // thread, where this closure runs. The webview is an NSView, so it is
        // also an NSResponder.
        unsafe {
            let panel = &*webview.ns_window().cast::<NSWindow>();
            panel.makeKeyAndOrderFront(None);
            let view = &*webview.inner().cast::<NSResponder>();
            panel.makeFirstResponder(Some(view));
        }
    })
}

/// Hands keyboard focus back to the app the user was in. A panel cannot
/// resign key status on its own, so it is ordered out and straight back in
/// without becoming key. Must be called on the main thread.
pub fn release_keyboard(window: &WebviewWindow) -> tauri::Result<()> {
    let ns_window = window.ns_window()?.cast::<NSWindow>();
    // SAFETY: Tauri hands out a valid NSWindow pointer that outlives this call.
    unsafe {
        let panel = &*ns_window;
        if panel.isKeyWindow() {
            panel.orderOut(None);
            panel.orderFrontRegardless();
        }
    }
    Ok(())
}

/// Calls `on_press` with the number of the window under every mouse press, in
/// this app or any other (another app's window never matches one of ours).
/// Watching mouse presses needs no accessibility permission. Lasts for the
/// app's life. Must be called on the main thread.
pub fn watch_presses(on_press: impl Fn(isize) + 'static) {
    let on_press = Rc::new(on_press);
    let mask = NSEventMask::LeftMouseDown | NSEventMask::RightMouseDown | NSEventMask::OtherMouseDown;
    let elsewhere = on_press.clone();
    // SAFETY (both handlers): AppKit hands them a valid event on the main thread.
    let global = RcBlock::new(move |event: NonNull<NSEvent>| elsewhere(unsafe { event.as_ref() }.windowNumber()));
    let local = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        on_press(unsafe { event.as_ref() }.windowNumber());
        event.as_ptr()
    });
    // The monitors stay for the app's life, so their handles are never released.
    std::mem::forget(NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &global));
    // SAFETY: the handler passes on the event it was given, a valid pointer.
    std::mem::forget(unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(mask, &local) });
}

/// The number AppKit gives the window, as `watch_presses` reports it.
pub fn window_number(window: &WebviewWindow) -> tauri::Result<isize> {
    let ns_window = window.ns_window()?.cast::<NSWindow>();
    // SAFETY: Tauri hands out a valid NSWindow pointer that outlives this call.
    Ok(unsafe { (*ns_window).windowNumber() })
}

/// Brings the pet to the front without making it the key window: a plain
/// `show()` would, and the user's next keystrokes would land in the pet.
/// Must be called on the main thread.
pub fn show_without_focus(window: &WebviewWindow) -> tauri::Result<()> {
    let ns_window = window.ns_window()?.cast::<NSWindow>();
    // SAFETY: Tauri hands out a valid NSWindow pointer that outlives this call.
    unsafe { (*ns_window).orderFrontRegardless() };
    Ok(())
}
