mod chat;
mod click_through;
#[cfg(target_os = "macos")]
mod floating_panel;
mod holidays;
mod mimo;
mod proxy;
mod quick_chat;
mod secrets;
mod system;
mod translation;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    App, AppHandle, Emitter, Manager, State, WebviewWindow, Wry,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
};

const MAIN_WINDOW: &str = "main";
/// Emitted to the webview with the requested size multiplier as payload.
const SCALE_EVENT: &str = "pet://scale";
const ON_TOP_EVENT: &str = "pet://on-top";
/// Emitted with whether do-not-disturb is on. Must match `src/platform/petWindow.ts`.
const DND_EVENT: &str = "pet://dnd";
/// "摸摸头" in the menu. Must match `src/platform/petWindow.ts`.
const PAT_EVENT: &str = "pet://pat";
/// Tells the settings window which section to show; must match `src/platform/petWindow.ts`.
const SETTINGS_SECTION_EVENT: &str = "pet://settings-section";
/// The pet was shown again (menu, Dock icon, a reminder); the webview keeps it on screen. Must match `src/platform/petWindow.ts`.
const REVEALED_EVENT: &str = "pet://revealed";
/// The focus item in the menu was picked; the payload says whether to start a round. Must match `src/platform/petWindow.ts`.
const FOCUS_EVENT: &str = "pet://focus";
const SCALE_ID_PREFIX: &str = "scale:";
const TOGGLE_ID: &str = "toggle";
const PAT_ID: &str = "pat";
const ON_TOP_ID: &str = "on_top";
const DND_ID: &str = "dnd";
const QUIT_ID: &str = "quit";
const SETTINGS_ID: &str = "settings";
const NOTES_ID: &str = "notes";
const CHAT_ID: &str = "chat";
const TODAY_ID: &str = "today";
const FOCUS_ID: &str = "focus";
/// The focus item's label for each phase; must match `FocusPhase` in `src/behavior/FocusTimer.ts`.
const FOCUS_LABELS: [(&str, &str); 3] = [("off", "开始专注"), ("focusing", "停止专注"), ("resting", "结束休息")];
/// Pet sizes in the menu: the value after `SCALE_ID_PREFIX`, and the label used by the settings page too.
const SIZES: [(&str, &str); 3] = [("0.75", "小"), ("1", "标准"), ("1.3", "大")];
const HIDE_PET_LABEL: &str = "隐藏宠物";
const SHOW_PET_LABEL: &str = "显示宠物";
const SETTINGS_WINDOW: &str = "settings";
const CHAT_WINDOW: &str = "chat";
const TODAY_WINDOW: &str = "today";
const NOTES_WINDOW: &str = "notes";

/// The one menu shared by the tray icon and the pet's right-click menu.
struct PetMenu {
    menu: Menu<Wry>,
    visibility: MenuItem<Wry>,
    focus: MenuItem<Wry>,
    /** Whether a focus round or rest is running, so the item knows what a click means. */
    focus_running: AtomicBool,
    on_top: CheckMenuItem<Wry>,
    dnd: CheckMenuItem<Wry>,
    sizes: Vec<(f64, CheckMenuItem<Wry>)>,
}

impl PetMenu {
    /// Ticks the size closest to `scale`; a click on a check item flips it, so every item is set.
    fn check_scale(&self, scale: f64) {
        for (value, item) in &self.sizes {
            report("tick pet size", item.set_checked((value - scale).abs() < 0.01));
        }
    }
}

/// The show/hide item names what it will do, so it follows the pet window.
pub(crate) fn sync_pet_visibility(app: &AppHandle, visible: bool) {
    if let Some(menu) = app.try_state::<PetMenu>() {
        let label = if visible { HIDE_PET_LABEL } else { SHOW_PET_LABEL };
        report("rename show/hide item", menu.visibility.set_text(label));
    }
}

struct OnTopState(AtomicBool);

fn report<T>(action: &str, result: tauri::Result<T>) {
    if let Err(error) = result {
        eprintln!("failed to {action}: {error}");
    }
}

/// Shows the pet if it is hidden, without taking the keyboard, renames the
/// menu item and lets the webview pull it back onto a screen.
/// Must be called on the main thread.
pub(crate) fn reveal_pet(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    #[cfg(target_os = "macos")]
    report("show pet", floating_panel::show_without_focus(&window));
    #[cfg(not(target_os = "macos"))]
    report("show pet", window.show());
    sync_pet_visibility(app, true);
    report("emit revealed event", app.emit_to(MAIN_WINDOW, REVEALED_EVENT, ()));
}

fn toggle_visibility(app: &AppHandle, window: &WebviewWindow) {
    match window.is_visible() {
        Ok(true) => {
            report("hide window", window.hide());
            sync_pet_visibility(app, false);
        }
        Ok(false) => reveal_pet(app),
        Err(error) => eprintln!("failed to read window visibility: {error}"),
    }
}

/// Shows the pet if it is hidden, e.g. for a reminder that came due. Sync, so it runs on the main thread.
#[tauri::command]
fn show_pet(app: AppHandle) {
    let hidden = app
        .get_webview_window(MAIN_WINDOW)
        .is_some_and(|window| !window.is_visible().unwrap_or(true));
    if hidden {
        reveal_pet(&app);
    }
}

/// Renames the focus item for the phase the pet window reports.
#[tauri::command]
fn sync_focus_menu(menu: State<'_, PetMenu>, phase: String) -> Result<(), String> {
    let label = FOCUS_LABELS
        .iter()
        .find(|(name, _)| *name == phase)
        .map(|(_, label)| *label)
        .ok_or("Invalid focus phase")?;
    menu.focus_running.store(phase != "off", Ordering::Relaxed);
    menu.focus.set_text(label).map_err(|error| error.to_string())
}

/// Things to do with the pet first, then how it behaves, then the app. Same order in the tray.
fn build_menu(app: &App) -> tauri::Result<PetMenu> {
    let item = |id: &str, label: &str| MenuItem::with_id(app, id, label, true, None::<&str>);
    // The pet's own "聊聊天" button opens the bar under it; this opens the full window, so it says so.
    let chat = item(CHAT_ID, "打开聊天窗口")?;
    let today = item(TODAY_ID, "提醒")?;
    let notes = item(NOTES_ID, "备忘")?;
    let pat = item(PAT_ID, "摸摸头")?;
    let focus = item(FOCUS_ID, FOCUS_LABELS[0].1)?;
    let sizes = SIZES
        .iter()
        .map(|(value, label)| {
            let id = format!("{SCALE_ID_PREFIX}{value}");
            let scale = value.parse::<f64>().unwrap_or(1.0);
            CheckMenuItem::with_id(app, id, *label, true, scale == 1.0, None::<&str>).map(|item| (scale, item))
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let size_items: Vec<&dyn tauri::menu::IsMenuItem<Wry>> = sizes.iter().map(|(_, item)| item as _).collect();
    let size = Submenu::with_items(app, "大小", true, &size_items)?;
    let on_top = CheckMenuItem::with_id(app, ON_TOP_ID, "总在最前面", true, true, None::<&str>)?;
    let dnd = CheckMenuItem::with_id(app, DND_ID, "勿扰", true, false, None::<&str>)?;
    let visibility = item(TOGGLE_ID, HIDE_PET_LABEL)?;
    let settings = item(SETTINGS_ID, "设置…")?;
    let quit = item(QUIT_ID, "退出 AI Pet")?;
    let menu = Menu::with_items(
        app,
        &[
            &chat,
            &today,
            &notes,
            &PredefinedMenuItem::separator(app)?,
            &pat,
            &focus,
            &PredefinedMenuItem::separator(app)?,
            &size,
            &on_top,
            &dnd,
            &visibility,
            &PredefinedMenuItem::separator(app)?,
            &settings,
            &quit,
        ],
    )?;
    Ok(PetMenu { menu, visibility, focus, focus_running: AtomicBool::new(false), on_top, dnd, sizes })
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    if id == QUIT_ID {
        if let Some(state) = app.try_state::<std::sync::Arc<chat::ChatState>>() {
            state.cancel_all();
        }
        if let Some(state) = app.try_state::<std::sync::Arc<mimo::MimoSpeechState>>() {
            state.cancel_all();
        }
        app.exit(0);
        return;
    }
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let Some(menu) = app.try_state::<PetMenu>() else {
        return;
    };
    let on_top = &menu.on_top;
    match id {
        TOGGLE_ID => toggle_visibility(app, &window),
        CHAT_ID | TODAY_ID => {
            let label = if id == CHAT_ID { CHAT_WINDOW } else { TODAY_WINDOW };
            if let Err(error) = show_beside_pet(app, label) {
                eprintln!("failed to open {label}: {error}");
            }
        }
        PAT_ID => report("emit pat event", app.emit_to(MAIN_WINDOW, PAT_EVENT, ())),
        // true: start a round; false: stop the round or the rest.
        FOCUS_ID => report(
            "emit focus event",
            app.emit_to(MAIN_WINDOW, FOCUS_EVENT, !menu.focus_running.load(Ordering::Relaxed)),
        ),
        NOTES_ID => {
            if let Err(error) = show_beside_pet(app, NOTES_WINDOW) {
                eprintln!("failed to open notes: {error}");
            }
        }
        // The check mark has already been flipped by the time this fires.
        ON_TOP_ID => match on_top.is_checked() {
            Ok(checked) => match set_on_top(&window, checked) {
                Ok(()) => {
                    if let Some(state) = app.try_state::<OnTopState>() {
                        state.0.store(checked, Ordering::Relaxed);
                    }
                    report("emit on-top event", app.emit(ON_TOP_EVENT, checked));
                }
                Err(error) => eprintln!("failed to set always on top: {error}"),
            },
            Err(error) => eprintln!("failed to read menu state: {error}"),
        },
        // The pet window saves the new value; see `petWindow.onDoNotDisturbChanged`.
        DND_ID => match menu.dnd.is_checked() {
            Ok(checked) => report("emit dnd event", app.emit(DND_EVENT, checked)),
            Err(error) => eprintln!("failed to read menu state: {error}"),
        },
        SETTINGS_ID => {
            if let Some(settings) = app.get_webview_window(SETTINGS_WINDOW) {
                report("show settings", settings.show());
                report("focus settings", settings.set_focus());
            }
        }
        _ => {
            if let Some(scale) = id
                .strip_prefix(SCALE_ID_PREFIX)
                .and_then(|value| value.parse::<f64>().ok())
            {
                menu.check_scale(scale);
                report("emit scale event", app.emit(SCALE_EVENT, scale));
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn set_on_top(window: &WebviewWindow, on_top: bool) -> tauri::Result<()> {
    floating_panel::set_on_top(window, on_top)
}

#[cfg(not(target_os = "macos"))]
fn set_on_top(window: &WebviewWindow, on_top: bool) -> tauri::Result<()> {
    window.set_always_on_top(on_top)
}

/// Opens the pet menu at the cursor. Called from the webview on right-click.
#[tauri::command]
fn show_pet_menu(window: WebviewWindow, menu: State<'_, PetMenu>) -> Result<(), String> {
    window
        .popup_menu(&menu.menu)
        .map_err(|error| format!("failed to open the pet menu: {error}"))
}

#[tauri::command]
fn get_pet_on_top(state: State<'_, OnTopState>) -> bool {
    state.0.load(Ordering::Relaxed)
}

#[tauri::command]
fn set_pet_on_top(
    app: AppHandle,
    state: State<'_, OnTopState>,
    enabled: bool,
) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| "main window is unavailable".to_string())?;
    set_on_top(&window, enabled).map_err(|error| error.to_string())?;
    if let Some(menu) = app.try_state::<PetMenu>() {
        menu.on_top
            .set_checked(enabled)
            .map_err(|error| error.to_string())?;
    }
    state.0.store(enabled, Ordering::Relaxed);
    app.emit(ON_TOP_EVENT, enabled)
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Syncs the menu check mark with the saved setting and tells every window.
#[tauri::command]
fn set_pet_dnd(app: AppHandle, menu: State<'_, PetMenu>, enabled: bool) -> Result<(), String> {
    menu.dnd
        .set_checked(enabled)
        .map_err(|error| error.to_string())?;
    app.emit(DND_EVENT, enabled)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_deepseek_key_page() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("/usr/bin/open")
            .arg("https://platform.deepseek.com/api_keys")
            .status()
            .map_err(|_| "Failed to open browser".to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Failed to open browser".into())
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Opening this page is currently supported on macOS".into())
    }
}

/// A rectangle in logical screen pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Area {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Room between the pet and a window opened beside it.
const BESIDE_GAP: f64 = 12.0;

/// Where to put a window of `size` beside the pet: on the right if there is
/// room, else on the left, kept inside the usable area (`work`, without the
/// menu bar and the Dock). All in logical pixels: screens with different
/// scales do not share physical ones.
fn beside(pet: Area, size: (f64, f64), work: Area) -> (f64, f64) {
    let max_x = (work.x + work.width - size.0).max(work.x);
    let max_y = (work.y + work.height - size.1).max(work.y);
    let after = pet.x + pet.width + BESIDE_GAP;
    let before = pet.x - size.0 - BESIDE_GAP;
    let x = if after <= max_x { after } else { before }.clamp(work.x, max_x);
    (x, pet.y.clamp(work.y, max_y))
}

/// The usable area of the monitor under the middle of the pet, or the nearest
/// one. Not `current_monitor()`: right after a drag it can still name the old one.
fn work_area_under(app: &AppHandle, pet: Area) -> Option<Area> {
    let (cx, cy) = (pet.x + pet.width / 2.0, pet.y + pet.height / 2.0);
    let areas: Vec<Area> = app
        .available_monitors()
        .ok()?
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            let work = monitor.work_area();
            let position = work.position.to_logical::<f64>(scale);
            let size = work.size.to_logical::<f64>(scale);
            Area { x: position.x, y: position.y, width: size.width, height: size.height }
        })
        .collect();
    let distance = |area: &Area| {
        let dx = (area.x - cx).max(0.0).max(cx - (area.x + area.width));
        let dy = (area.y - cy).max(0.0).max(cy - (area.y + area.height));
        dx.hypot(dy)
    };
    areas.into_iter().min_by(|a, b| distance(a).total_cmp(&distance(b)))
}

/// Shows a window next to the pet, on whichever side has room, and focuses it.
fn show_beside_pet(app: &AppHandle, label: &str) -> Result<(), String> {
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("{label} window is unavailable"))?;
    if let Some(pet) = app.get_webview_window(MAIN_WINDOW) {
        if let (Ok(position), Ok(pet_size), Ok(pet_scale), Ok(size), Ok(scale)) = (
            pet.outer_position(),
            pet.outer_size(),
            pet.scale_factor(),
            window.outer_size(),
            window.scale_factor(),
        ) {
            let origin = position.to_logical::<f64>(pet_scale);
            let extent = pet_size.to_logical::<f64>(pet_scale);
            let pet_area = Area { x: origin.x, y: origin.y, width: extent.width, height: extent.height };
            let own = size.to_logical::<f64>(scale);
            if let Some(work) = work_area_under(app, pet_area) {
                let (x, y) = beside(pet_area, (own.width, own.height), work);
                report("place window beside the pet", window.set_position(tauri::LogicalPosition::new(x, y)));
            }
        }
    }
    // The popovers are panels (see `setup`): focusing them must not activate the
    // app, or a user in a full-screen app is pulled out of it.
    #[cfg(target_os = "macos")]
    if label == TODAY_WINDOW || label == NOTES_WINDOW {
        return floating_panel::take_keyboard(&window).map_err(|e| e.to_string());
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[cfg(test)]
mod beside_tests {
    use super::{Area, beside, BESIDE_GAP};

    const WORK: Area = Area { x: 0.0, y: 25.0, width: 1440.0, height: 800.0 };

    #[test]
    fn opens_on_the_right_when_there_is_room() {
        let pet = Area { x: 100.0, y: 300.0, width: 392.0, height: 384.0 };
        assert_eq!(beside(pet, (360.0, 520.0), WORK), (100.0 + 392.0 + BESIDE_GAP, 300.0));
    }

    #[test]
    fn opens_on_the_left_near_the_right_edge_and_stays_above_the_dock() {
        let pet = Area { x: 1100.0, y: 600.0, width: 392.0, height: 384.0 };
        let (x, y) = beside(pet, (360.0, 520.0), WORK);
        assert_eq!(x, 1100.0 - 360.0 - BESIDE_GAP);
        assert_eq!(y, 25.0 + 800.0 - 520.0);
    }
}

#[tauri::command]
fn open_chat(app: AppHandle) -> Result<(), String> {
    show_beside_pet(&app, CHAT_WINDOW)
}

#[tauri::command]
fn open_today(app: AppHandle) -> Result<(), String> {
    show_beside_pet(&app, TODAY_WINDOW)
}

#[tauri::command]
fn open_notes(app: AppHandle) -> Result<(), String> {
    show_beside_pet(&app, NOTES_WINDOW)
}

/// Shows the settings window, optionally on one section, such as "ai" from the chat window.
#[tauri::command]
fn open_settings(app: AppHandle, section: Option<String>) -> Result<(), String> {
    let window = app
        .get_webview_window(SETTINGS_WINDOW)
        .ok_or("Settings window is missing")?;
    if let Some(section) = section {
        if section.is_empty() || section.len() > 32 || !section.bytes().all(|c| c.is_ascii_lowercase()) {
            return Err("Invalid settings section".into());
        }
        app.emit_to(SETTINGS_WINDOW, SETTINGS_SECTION_EVENT, section)
            .map_err(|e| e.to_string())?;
    }
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn request_pet_scale(app: AppHandle, scale: f64) -> Result<(), String> {
    if !(0.5..=2.0).contains(&scale) {
        return Err("scale must be between 0.5 and 2.0".to_string());
    }
    if let Some(menu) = app.try_state::<PetMenu>() {
        menu.check_scale(scale);
    }
    app.emit(SCALE_EVENT, scale)
        .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(quick_chat::on_shortcut)
                .build(),
        )
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(click_through::HitMask::default())
        .manage(quick_chat::Shortcuts::default())
        .manage(translation::Selection::default())
        .manage(translation::SelectionFloat::default())
        .manage(OnTopState(AtomicBool::new(true)))
        .manage(std::sync::Arc::new(chat::ChatState::default()))
        .manage(std::sync::Arc::new(mimo::MimoSpeechState::default()))
        .setup(|app| {
            // A desktop pet should not occupy a Dock slot.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let pet_menu = build_menu(app)?;
            app.on_menu_event(move |app, event| handle_menu_event(app, event.id().as_ref()));

            // A template image: black on transparent, so macOS tints it for light and dark menu bars.
            TrayIconBuilder::new()
                .menu(&pet_menu.menu)
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template@2x.png"))?)
                .icon_as_template(true)
                .build(app)?;

            app.manage(pet_menu);

            // The window starts hidden and is shown only now: macOS decides which
            // spaces a window belongs to from its settings at the moment it appears.
            if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
                #[cfg(target_os = "macos")]
                {
                    floating_panel::apply(&window)?;
                    floating_panel::show_without_focus(&window)?;
                }
                #[cfg(not(target_os = "macos"))]
                window.show()?;
            }
            if let Some(settings) = app.get_webview_window(SETTINGS_WINDOW) {
                let settings_handle = settings.clone();
                settings.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        report("hide settings", settings_handle.hide());
                    }
                });
            }
            // The today and notes panels behave like popovers: they go away when they lose focus.
            for label in [TODAY_WINDOW, NOTES_WINDOW] {
                if let Some(panel) = app.get_webview_window(label) {
                    #[cfg(target_os = "macos")]
                    floating_panel::apply_popover(&panel)?;
                    let handle = panel.clone();
                    panel.on_window_event(move |event| match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            report("hide panel", handle.hide());
                        }
                        tauri::WindowEvent::Focused(false) => report("hide panel", handle.hide()),
                        _ => {}
                    });
                }
            }
            if let Some(chat_window) = app.get_webview_window(CHAT_WINDOW) {
                let handle = chat_window.clone();
                let app_handle = app.handle().clone();
                chat_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        // Only its own replies: the pet window may be answering too.
                        if let Some(state) =
                            app_handle.try_state::<std::sync::Arc<chat::ChatState>>()
                        {
                            state.cancel_window(CHAT_WINDOW);
                        }
                        if let Some(state) =
                            app_handle.try_state::<std::sync::Arc<mimo::MimoSpeechState>>()
                        {
                            state.cancel_all();
                        }
                        let _ = handle.emit("pet://chat-hide", ());
                        report("hide chat", handle.hide());
                    }
                });
            }
            if let Some(window) = app.get_webview_window("translation") {
                #[cfg(target_os = "macos")]
                floating_panel::apply_popover(&window)?;
                let handle = window.clone();
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        app_handle.state::<std::sync::Arc<chat::ChatState>>().cancel_window("translation");
                        let _ = handle.emit("pet://translation-hide", ());
                        report("hide translation", handle.hide());
                    }
                });
            }
            if let Some(window) = app.get_webview_window("selection-float") {
                #[cfg(target_os = "macos")]
                floating_panel::apply_popover(&window)?;
            }
            translation::start_selection_monitor(app.handle().clone());
            click_through::start(app.handle().clone(), MAIN_WINDOW);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_deepseek_key_page,
            open_chat,
            open_today,
            open_notes,
            open_settings,
            set_pet_dnd,
            quick_chat::set_quick_chat_shortcut,
            quick_chat::set_translation_shortcut,
            translation::open_translation,
            translation::selection_status,
            translation::take_translation_selection,
            translation::set_selection_float,
            translation::translate_floating_selection,
            translation::expand_selection_float,
            translation::close_selection_float,
            quick_chat::take_pet_keyboard,
            quick_chat::release_pet_keyboard,
            chat::deepseek_test,
            chat::deepseek_key_status,
            chat::deepseek_save_key,
            chat::deepseek_clear_key,
            chat::deepseek_start,
            chat::deepseek_translate,
            chat::deepseek_preview,
            chat::deepseek_cancel,
            chat::deepseek_greet,
            chat::deepseek_title,
            holidays::fetch_holiday_year,
            mimo::mimo_speech_cancel,
            mimo::mimo_key_status,
            mimo::mimo_save_key,
            mimo::mimo_clear_key,
            mimo::mimo_transcribe,
            mimo::mimo_transcribe_cancel,
            mimo::mimo_synthesize,
            show_pet_menu,
            get_pet_on_top,
            set_pet_on_top,
            request_pet_scale,
            click_through::set_hit_mask,
            system::launch_at_login_status,
            system::set_launch_at_login,
            system::open_login_items_settings,
            system::open_link,
            system::open_microphone_settings,
            system::open_accessibility_settings,
            system::system_idle_seconds,
            system::save_backup,
            system::save_character_package,
            system::restart_app,
            show_pet,
            sync_focus_menu
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Clicking the app again (Finder, Launchpad, Spotlight) brings a hidden pet back:
            // the menu bar icon may be hidden behind the notch.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                reveal_pet(app);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
