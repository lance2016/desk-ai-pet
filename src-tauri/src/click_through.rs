//! Lets the mouse pass through the transparent parts of the pet window.
//!
//! The webview reports which parts of the window are drawn (the hit mask). A
//! background thread compares the cursor position against it and switches the
//! window between "takes mouse input" and "ignores mouse input".

use std::{sync::Mutex, thread, time::Duration};

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

/// Emitted to the webview with `true` when the cursor moves onto the pet and
/// `false` when it leaves.
const HOVER_EVENT: &str = "pet://hover";
const POLL_INTERVAL: Duration = Duration::from_millis(40);

/// Which cells of the window are drawn, as rows of square cells from the top left.
struct Grid {
    /// Side of one cell in logical pixels.
    cell: f64,
    columns: usize,
    cells: Vec<bool>,
}

impl Grid {
    fn contains(&self, x: f64, y: f64) -> bool {
        if x < 0.0 || y < 0.0 {
            return false;
        }
        let column = (x / self.cell) as usize;
        let row = (y / self.cell) as usize;
        column < self.columns
            && self
                .cells
                .get(row * self.columns + column)
                .copied()
                .unwrap_or(false)
    }
}

/// The latest hit mask. Empty until the webview has sent one.
#[derive(Default)]
pub struct HitMask(Mutex<Option<Grid>>);

/// Replaces the hit mask. Called by the webview whenever what it draws changes.
#[tauri::command]
pub fn set_hit_mask(
    mask: State<'_, HitMask>,
    cell: f64,
    columns: usize,
    cells: Vec<bool>,
) -> Result<(), String> {
    if !cell.is_finite() || cell <= 0.0 || columns == 0 || cells.len() % columns != 0 {
        return Err("invalid hit mask".into());
    }
    let mut current = mask
        .0
        .lock()
        .map_err(|error| format!("hit mask is unavailable: {error}"))?;
    *current = Some(Grid {
        cell,
        columns,
        cells,
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn mouse_button_down() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceButtonState(state_id: i32, button: u32) -> bool;
    }
    const COMBINED_SESSION_STATE: i32 = 0;
    const LEFT_BUTTON: u32 = 0;
    const RIGHT_BUTTON: u32 = 1;
    // SAFETY: a plain C query with no pointers, callable from any thread.
    unsafe {
        CGEventSourceButtonState(COMBINED_SESSION_STATE, LEFT_BUTTON)
            || CGEventSourceButtonState(COMBINED_SESSION_STATE, RIGHT_BUTTON)
    }
}

#[cfg(not(target_os = "macos"))]
fn mouse_button_down() -> bool {
    false
}

/// The cursor relative to the window's top left, in logical pixels.
///
/// tao turns the cursor into physical pixels with the primary screen's scale,
/// but the window origin with the scale of the screen the window is on. On two
/// screens with different scales the physical values cannot be subtracted, so
/// both go back to logical pixels first.
fn cursor_in_window(cursor: (f64, f64), primary_scale: f64, origin: (f64, f64), window_scale: f64) -> (f64, f64) {
    (
        cursor.0 / primary_scale - origin.0 / window_scale,
        cursor.1 / primary_scale - origin.1 / window_scale,
    )
}

/// Whether the cursor is over a drawn part of the window. `None` when it
/// cannot be told yet, in which case the window is left as it is.
fn cursor_over_pet(app: &AppHandle, window: &WebviewWindow) -> Option<bool> {
    // Read the window first: these calls wait for the main thread, which must
    // not happen while the mask is locked.
    let cursor = app.cursor_position().ok()?;
    let primary_scale = app.primary_monitor().ok()??.scale_factor();
    let origin = window.outer_position().ok()?;
    let window_scale = window.scale_factor().ok()?;
    let (x, y) = cursor_in_window(
        (cursor.x, cursor.y),
        primary_scale,
        (f64::from(origin.x), f64::from(origin.y)),
        window_scale,
    );

    let mask = app.state::<HitMask>();
    let current = mask.0.lock().ok()?;
    current.as_ref().map(|grid| grid.contains(x, y))
}

/// Where the press in progress began, from the window's state when it was first seen.
/// `None` while no button is held.
fn press_start(previous: Option<bool>, button_down: bool, over_pet: Option<bool>) -> Option<bool> {
    match (button_down, previous) {
        (false, _) => None,
        (true, Some(began_on_pet)) => Some(began_on_pet),
        (true, None) => Some(over_pet == Some(true)),
    }
}

/// Starts following the cursor for the given window.
pub fn start(app: AppHandle, window_label: &'static str) {
    thread::spawn(move || {
        let mut over_pet: Option<bool> = None;
        let mut pressed_on_pet: Option<bool> = None;
        loop {
            thread::sleep(POLL_INTERVAL);
            // A press that began on the pet (a drag, a menu) must keep going to
            // the window even if the cursor slips onto a transparent part. One that
            // began elsewhere may be a file dragged in from another app: the window
            // keeps following the cursor, so it can take the drop.
            pressed_on_pet = press_start(pressed_on_pet, mouse_button_down(), over_pet);
            if pressed_on_pet == Some(true) {
                continue;
            }
            let Some(window) = app.get_webview_window(window_label) else {
                continue;
            };
            // Nothing to hit while the pet is hidden.
            if !window.is_visible().unwrap_or(true) {
                continue;
            }
            let Some(now_over) = cursor_over_pet(&app, &window) else {
                continue;
            };
            if over_pet == Some(now_over) {
                continue;
            }
            match window.set_ignore_cursor_events(!now_over) {
                Ok(()) => {
                    over_pet = Some(now_over);
                    if let Err(error) = app.emit(HOVER_EVENT, now_over) {
                        log::warn!("failed to emit hover event: {error}");
                    }
                }
                Err(error) => log::warn!("failed to switch click-through: {error}"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{cursor_in_window, press_start};

    #[test]
    fn a_press_on_the_pet_holds_the_window_until_released() {
        let pressed = press_start(None, true, Some(true));
        assert_eq!(pressed, Some(true));
        // The cursor slips off the pet mid-drag: still the same press.
        assert_eq!(press_start(pressed, true, Some(false)), Some(true));
        assert_eq!(press_start(pressed, false, Some(true)), None);
    }

    #[test]
    fn a_press_elsewhere_lets_the_window_follow_a_drag_onto_the_pet() {
        let pressed = press_start(None, true, Some(false));
        assert_eq!(pressed, Some(false));
        // The drag reaches the pet and the window takes the cursor: still a press from elsewhere.
        assert_eq!(press_start(pressed, true, Some(true)), Some(false));
        assert_eq!(press_start(None, true, None), Some(false));
    }

    #[test]
    fn same_scale_matches_plain_subtraction() {
        assert_eq!(cursor_in_window((240.0, 120.0), 2.0, (200.0, 100.0), 2.0), (20.0, 10.0));
    }

    #[test]
    fn window_on_a_1x_screen_next_to_a_retina_primary() {
        // Primary is Retina (2x); the window sits on an external 1x screen at logical x 1500.
        // Cursor at logical (1510, 40) arrives as physical (3020, 80); origin arrives as (1500, 30).
        assert_eq!(cursor_in_window((3020.0, 80.0), 2.0, (1500.0, 30.0), 1.0), (10.0, 10.0));
    }
}
