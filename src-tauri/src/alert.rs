//! A native confirmation for a step that cannot be undone, such as deleting a character.
//!
//! The dialog plugin's message box makes the first button the Return key and only lets
//! Escape reach a button titled "Cancel" in English, so this builds the `NSAlert` itself:
//! Return confirms the step the user just asked for, Escape cancels, and the confirming
//! button is drawn as destructive.

use tauri::AppHandle;

/// Shows the confirmation and waits for the answer. True when the user confirmed.
#[tauri::command]
pub async fn confirm_action(app: AppHandle, message: String, detail: String, action: String) -> Result<bool, String> {
    if message.is_empty() || action.is_empty() || message.chars().count() > 200 || detail.chars().count() > 400 || action.chars().count() > 20 {
        return Err("Invalid confirmation text".into());
    }
    let (sender, receiver) = std::sync::mpsc::channel();
    // AppKit wants the main thread; this command runs elsewhere and waits for the answer.
    app.run_on_main_thread(move || {
        let _ = sender.send(run_alert(&message, &detail, &action));
    })
    .map_err(|error| format!("Failed to show the confirmation: {error}"))?;
    receiver.recv().map_err(|_| "The confirmation closed without an answer".to_string())
}

#[cfg(target_os = "macos")]
fn run_alert(message: &str, detail: &str, action: &str) -> bool {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn, NSAlertStyle, NSStatusWindowLevel};
    use objc2_foundation::NSString;

    let Some(main_thread) = MainThreadMarker::new() else {
        return false;
    };
    let alert = NSAlert::new(main_thread);
    alert.setMessageText(&NSString::from_str(message));
    alert.setInformativeText(&NSString::from_str(detail));
    alert.setAlertStyle(NSAlertStyle::Warning);
    let confirm = alert.addButtonWithTitle(&NSString::from_str(action));
    confirm.setHasDestructiveAction(true);
    let cancel = alert.addButtonWithTitle(&NSString::from_str("取消"));
    cancel.setKeyEquivalent(&NSString::from_str("\u{1b}"));
    // The pet and its panels sit at the status level (`floating_panel::set_on_top`), above the modal
    // panel level an alert gets. One under them could not be seen, and the app would look frozen.
    // Laid out first, so the level is set on the window as it will be shown.
    alert.layout();
    alert.window().setLevel(NSStatusWindowLevel + 1);
    alert.runModal() == NSAlertFirstButtonReturn
}

#[cfg(not(target_os = "macos"))]
fn run_alert(_message: &str, _detail: &str, _action: &str) -> bool {
    false
}
