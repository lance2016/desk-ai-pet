//! Keeps an ordinary window (settings, dubbing, chat) typable after the panels pass the keyboard around.
//!
//! The pet and the popovers take and give back the keyboard without activating the app. When a key
//! panel goes away while another app is in front, AppKit hands key status to the settings window
//! anyway. Coming back to the app later, AppKit sees that window as key already and sends no
//! "became key" notification, so WebKit keeps treating the page as inactive: a click puts no caret in
//! the search field and typing goes nowhere until the user clicks another app and back (2.0.0-rc-2).
//! Such a window is made key afresh, by way of the pet panel, once the app is active again.
//!
//! Opening one of these windows has a race of its own. A click on the pet makes the pet panel key
//! without activating the app; the window is then made key while the activation it asked for is
//! still on its way, and when it lands AppKit hands the keyboard back to the pet. The window and its
//! page never hear they lost it, so the field shows a caret while every key press goes to the pet
//! (2.0.0-rc-2, seen in the log). Whether that happens before or after AppKit's notifications
//! depends on how the window was opened, so `focus` looks again a few times in the next second and
//! takes the keyboard back from the pet when it finds it there.

use std::cell::{Cell, RefCell};
use std::ptr::NonNull;

use block2::RcBlock;
use objc2::{ClassType, MainThreadMarker, rc::Retained, runtime::NSObjectProtocol};
use objc2_app_kit::{
    NSApplication, NSApplicationDidBecomeActiveNotification, NSApplicationWillBecomeActiveNotification,
    NSPanel, NSWindow,
};
use objc2_foundation::{NSNotification, NSNotificationCenter};
use tauri::WebviewWindow;

thread_local! {
    /// The pet panel, the window key status passes through. Only touched on the main thread.
    static PET: RefCell<Option<Retained<NSWindow>>> = const { RefCell::new(None) };
    /// An ordinary window was still key while the app was coming back to the front.
    static STALE: Cell<bool> = const { Cell::new(false) };
}

/// When, after `focus`, to look whether the pet took the keyboard back (milliseconds, from the call).
const RECHECK_AFTER_MS: [u64; 3] = [100, 400, 1000];

/// A window as the log names it: its title and class. Never what is typed in it.
fn describe(window: Option<&NSWindow>) -> String {
    window.map_or_else(|| "none".into(), |window| format!("\"{}\" ({})", window.title(), window.class().name().to_string_lossy()))
}

/// The class of the window's first responder, such as the webview.
fn first_responder(window: Option<&NSWindow>) -> String {
    window.and_then(|window| window.firstResponder()).map_or_else(|| "none".into(), |responder| responder.class().name().to_string_lossy().into_owned())
}

/// Logs where the app's keyboard stands. `what` says what just happened.
fn log_keyboard(mtm: MainThreadMarker, what: &str, target: Option<&NSWindow>) {
    let app = NSApplication::sharedApplication(mtm);
    let key = app.keyWindow();
    log::info!(
        "Keyboard: {what}{} (key window {}, first responder {}, app active: {})",
        target.map_or_else(String::new, |window| format!(" in {}", describe(Some(window)))),
        describe(key.as_deref()),
        first_responder(key.as_deref()),
        app.isActive(),
    );
}

/// The key window when it is an ordinary window, not one of the panels.
fn ordinary_key_window(mtm: MainThreadMarker) -> Option<Retained<NSWindow>> {
    NSApplication::sharedApplication(mtm)
        .keyWindow()
        .filter(|window| !window.isKindOfClass(NSPanel::class()))
}

/// Moves key status to the pet and straight back, so the window and its page hear that it became key.
fn make_key_afresh(window: &NSWindow) {
    PET.with_borrow(|pet| {
        if let Some(pet) = pet {
            pet.makeKeyWindow();
        }
    });
    window.makeKeyAndOrderFront(None);
}

/// Whether the app is the one in front. For the log; false off the main thread.
pub fn app_active() -> bool {
    MainThreadMarker::new().is_some_and(|mtm| NSApplication::sharedApplication(mtm).isActive())
}

/// Watches the app coming back to the front. Must be called on the main thread, once.
pub fn install(pet: &WebviewWindow) -> tauri::Result<()> {
    let Some(mtm) = MainThreadMarker::new() else {
        log::warn!("key window watch not installed: not on the main thread");
        return Ok(());
    };
    let pet_window = pet.ns_window()?.cast::<NSWindow>();
    // SAFETY: Tauri hands out a valid NSWindow pointer; retaining it keeps it alive with the app.
    PET.set(unsafe { Retained::retain(pet_window) });

    // Before the app is active, an ordinary window should not be key: if one is, it went stale.
    let will = RcBlock::new(move |_: NonNull<NSNotification>| {
        STALE.set(ordinary_key_window(mtm).is_some());
    });
    let did = RcBlock::new(move |_: NonNull<NSNotification>| {
        if !STALE.replace(false) {
            return;
        }
        if let Some(window) = ordinary_key_window(mtm) {
            log::warn!("An ordinary window was still key when the app came back; making it key again");
            make_key_afresh(&window);
        }
    });
    let center = NSNotificationCenter::defaultCenter();
    // SAFETY: the names are AppKit's own constants; the notifications are posted on the main thread,
    // where the blocks run (no queue given) and where `mtm` is valid.
    unsafe {
        for (name, block) in [(NSApplicationWillBecomeActiveNotification, &will), (NSApplicationDidBecomeActiveNotification, &did)] {
            // The app keeps watching until it quits, so the observer is never removed.
            std::mem::forget(center.addObserverForName_object_queue_usingBlock(Some(name), None, None, block));
        }
    }
    Ok(())
}

/// Brings an ordinary window to the front with the keyboard, as `set_focus` does, and makes sure
/// the keyboard is still there once the activation it asks for has gone through (see the module notes).
/// Must be called on the main thread.
pub fn focus(window: &WebviewWindow) -> tauri::Result<()> {
    window.set_focus()?;
    if let Some(mtm) = MainThreadMarker::new() {
        // SAFETY: Tauri hands out a valid NSWindow pointer that outlives this call, on the main thread.
        let asked = unsafe { &*window.ns_window()?.cast::<NSWindow>() };
        log_keyboard(mtm, "asked to focus", Some(asked));
    }
    let window = window.clone();
    std::thread::spawn(move || {
        let mut waited = 0;
        for at in RECHECK_AFTER_MS {
            std::thread::sleep(std::time::Duration::from_millis(at - waited));
            waited = at;
            let target = window.clone();
            if let Err(error) = window.run_on_main_thread(move || take_back_from_pet(&target)) {
                log::warn!("could not check the keyboard after focusing a window: {error}");
                return;
            }
        }
    });
    Ok(())
}

/// Gives the window the keyboard when the pet has it, while the app is in front. Only from the pet:
/// a window the user went on to choose keeps it. Must be called on the main thread.
fn take_back_from_pet(window: &WebviewWindow) {
    let (Some(mtm), Ok(ns_window)) = (MainThreadMarker::new(), window.ns_window()) else { return };
    // SAFETY: Tauri hands out a valid NSWindow pointer that outlives this call, on the main thread.
    let asked = unsafe { &*ns_window.cast::<NSWindow>() };
    let app = NSApplication::sharedApplication(mtm);
    let key = app.keyWindow();
    let pet_has_it = PET.with_borrow(|pet| match (pet, &key) {
        (Some(pet), Some(key)) => Retained::as_ptr(pet) == Retained::as_ptr(key),
        _ => false,
    });
    if app.isActive() && asked.isVisible() && pet_has_it {
        log::warn!("The pet had the keyboard after {} was opened; giving it back", describe(Some(asked)));
        asked.makeKeyAndOrderFront(None);
    }
}

/// For a click that found the page inactive: when AppKit has the window as key all the same, brings
/// the app to the front and makes the window key afresh. A window that is not key, or one under a
/// confirmation or a save panel, rightly lacks the keyboard and is left alone, as are the panels.
/// Must be called on the main thread.
pub fn make_key_again(window: &WebviewWindow) -> tauri::Result<()> {
    let Some(mtm) = MainThreadMarker::new() else { return Ok(()) };
    let ns_window = window.ns_window()?.cast::<NSWindow>();
    // SAFETY: Tauri hands out a valid NSWindow pointer that outlives this call, on the main thread.
    let ns_window = unsafe { &*ns_window };
    let app = NSApplication::sharedApplication(mtm);
    if ns_window.isKindOfClass(NSPanel::class()) || !ns_window.isKeyWindow() || app.modalWindow().is_some() {
        return Ok(());
    }
    log::warn!("A click found the {} window's page inactive although it is key; making it key again", window.label());
    if !app.isActive() {
        // The user just clicked this window, so bringing the app forward is what they asked for.
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
    }
    make_key_afresh(ns_window);
    Ok(())
}
