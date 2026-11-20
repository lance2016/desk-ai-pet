mod alert;
mod api_keys;
mod click_through;
mod database;
mod diagnostics;
#[cfg(target_os = "macos")]
mod floating_panel;
mod handover;
mod holidays;
mod llm;
mod mail_code;
mod mail_extract;
mod mimo;
mod proxy;
mod quick_chat;
mod request_log;
mod secrets;
mod system;
mod translation;
mod worklog;

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
/// "今日回顾" in the pet menu. Must match `REVIEW_EVENT` in `src/platform/petWindow.ts`.
const REVIEW_EVENT: &str = "pet://review";
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
const REVIEW_ID: &str = "review";
const TRANSLATE_ID: &str = "translate";
const MAIL_CODE_ID: &str = "mail_code";
/// The mail code item names what a click will do: start waiting for a code, or stop.
const MAIL_CODE_LABEL: &str = "查收验证码";
const MAIL_CODE_STOP_LABEL: &str = "停止等验证码";
const CHAT_ID: &str = "chat";
const TODAY_ID: &str = "today";
const FOCUS_ID: &str = "focus";
/// The character's own buttons (feed, sleep, drawn actions) in the pet menu: an id with this prefix carries the button's key.
const DOCK_ID_PREFIX: &str = "dock:";
/// One of those buttons was picked; the payload is its key. Must match `src/platform/petWindow.ts`.
const DOCK_MENU_EVENT: &str = "pet://dock-item";
/// At most this many buttons go into the menu; the dock never shows more.
const MAX_DOCK_MENU_ITEMS: usize = 24;
/// "新聊天" in the app menu (⌘N); only enabled while the chat window is the key window.
const NEW_CHAT_ID: &str = "new_chat";
/// Starts a new chat from the app menu. Must match `src/platform/chat.ts`.
const NEW_CHAT_EVENT: &str = "pet://chat-new";
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
/// The reminder and note popovers: only one is open at a time, and a click outside puts both away.
const POPOVERS: [&str; 2] = [TODAY_WINDOW, NOTES_WINDOW];
/// After a popover loses focus, how long to wait before putting away every popover without it:
/// by then the window that took the focus has it, so the one the user just opened is kept.
const POPOVER_SWEEP_DELAY: std::time::Duration = std::time::Duration::from_millis(150);

/// The one menu shared by the tray icon and the pet's right-click menu.
struct PetMenu {
    menu: Menu<Wry>,
    visibility: MenuItem<Wry>,
    focus: MenuItem<Wry>,
    mail_code: MenuItem<Wry>,
    /** Whether a focus round or rest is running, so the item knows what a click means. */
    focus_running: AtomicBool,
    /// Whether the right-click menu is open. Opening it runs AppKit's menu loop, which still
    /// handles webview calls; a second right-click would open the same menu again inside it,
    /// and muda panics on the menu it is already holding.
    popped_up: AtomicBool,
    on_top: CheckMenuItem<Wry>,
    dnd: CheckMenuItem<Wry>,
    sizes: Vec<(f64, CheckMenuItem<Wry>)>,
    /// "动作": the same buttons as on the pet's sides, for when the mouse cannot reach them.
    dock: Submenu<Wry>,
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

/// Renames the mail code item while a wait runs, so the same item stops it.
pub(crate) fn sync_mail_code_menu(app: &AppHandle, waiting: bool) {
    if let Some(menu) = app.try_state::<PetMenu>() {
        let label = if waiting { MAIL_CODE_STOP_LABEL } else { MAIL_CODE_LABEL };
        report("rename mail code item", menu.mail_code.set_text(label));
    }
}

struct OnTopState(AtomicBool);

fn report<T>(action: &str, result: tauri::Result<T>) {
    if let Err(error) = result {
        log::warn!("failed to {action}: {error}");
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
        Err(error) => log::warn!("failed to read window visibility: {error}"),
    }
}

/// Shows the pet if it is hidden, e.g. for a reminder that came due. Sync, so it runs on the main thread.
#[tauri::command]
fn show_pet(app: AppHandle) {
    show_pet_if_hidden(&app);
}

/// Must be called on the main thread.
pub(crate) fn show_pet_if_hidden(app: &AppHandle) {
    let hidden = app
        .get_webview_window(MAIN_WINDOW)
        .is_some_and(|window| !window.is_visible().unwrap_or(true));
    if hidden {
        reveal_pet(app);
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
    let review = item(REVIEW_ID, "今日回顾")?;
    let translate = item(TRANSLATE_ID, "翻译…")?;
    let mail_code = item(MAIL_CODE_ID, MAIL_CODE_LABEL)?;
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
    // Filled by the pet window (`sync_dock_menu`) once it knows the character's buttons.
    let dock = Submenu::with_items(app, "动作", false, &[])?;
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
            &review,
            &translate,
            &mail_code,
            &PredefinedMenuItem::separator(app)?,
            &pat,
            &dock,
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
    Ok(PetMenu { menu, visibility, focus, mail_code, focus_running: AtomicBool::new(false), popped_up: AtomicBool::new(false), on_top, dnd, sizes, dock })
}

/// The app's menu bar. It shows only while the settings window keeps the app in the Dock,
/// but its key equivalents (⌘, ⌘N ⌘W ⌘Q and editing) work in every window.
/// Quit uses the pet menu's id, so ⌘Q stops running replies like the menu item does.
fn build_app_menu(app: &App) -> tauri::Result<(Menu<Wry>, MenuItem<Wry>)> {
    let settings = MenuItem::with_id(app, SETTINGS_ID, "设置…", true, Some("CmdOrCtrl+,"))?;
    let quit = MenuItem::with_id(app, QUIT_ID, "退出 AI Pet", true, Some("CmdOrCtrl+Q"))?;
    let new_chat = MenuItem::with_id(app, NEW_CHAT_ID, "新聊天", false, Some("CmdOrCtrl+N"))?;
    let app_menu = Submenu::with_items(app, "AI Pet", true, &[&settings, &PredefinedMenuItem::separator(app)?, &quit])?;
    let file = Submenu::with_items(app, "文件", true, &[&new_chat, &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?])?;
    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("拷贝"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;
    let window = Submenu::with_items(app, "窗口", true, &[&PredefinedMenuItem::minimize(app, Some("最小化"))?])?;
    Ok((Menu::with_items(app, &[&app_menu, &file, &edit, &window])?, new_chat))
}

/// The "新聊天" item of the app menu, enabled while the chat window has focus.
struct NewChatItem(MenuItem<Wry>);

/// The settings window is an ordinary window. While it is open the app shows in the
/// Dock and ⌘Tab, with its menu bar, so the window can be found again behind others.
/// The rest of the time the app stays an accessory, as the floating pet was built for.
fn show_settings_window(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Regular)?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    window.show()?;
    window.set_focus()
}

fn hide_settings_window(app: &AppHandle, window: &WebviewWindow) -> tauri::Result<()> {
    window.hide()?;
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Accessory)?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

fn handle_menu_event(app: &AppHandle, id: &str) {
    if id == QUIT_ID {
        if let Some(state) = app.try_state::<std::sync::Arc<llm::LlmState>>() {
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
                log::warn!("failed to open {label}: {error}");
            }
        }
        PAT_ID => report("emit pat event", app.emit_to(MAIN_WINDOW, PAT_EVENT, ())),
        // The pet window starts the review in the chat window; see `petWindow.onReviewRequested`.
        REVIEW_ID => report("emit review event", app.emit_to(MAIN_WINDOW, REVIEW_EVENT, ())),
        // true: start a round; false: stop the round or the rest.
        FOCUS_ID => report(
            "emit focus event",
            app.emit_to(MAIN_WINDOW, FOCUS_EVENT, !menu.focus_running.load(Ordering::Relaxed)),
        ),
        NOTES_ID => {
            if let Err(error) = show_beside_pet(app, NOTES_WINDOW) {
                log::warn!("failed to open notes: {error}");
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
                Err(error) => log::warn!("failed to set always on top: {error}"),
            },
            Err(error) => log::warn!("failed to read menu state: {error}"),
        },
        // The pet window saves the new value; see `petWindow.onDoNotDisturbChanged`.
        DND_ID => match menu.dnd.is_checked() {
            Ok(checked) => report("emit dnd event", app.emit(DND_EVENT, checked)),
            Err(error) => log::warn!("failed to read menu state: {error}"),
        },
        TRANSLATE_ID => translation::open_translation(app.clone()),
        MAIL_CODE_ID => mail_code::toggle(app),
        SETTINGS_ID => {
            if let Some(settings) = app.get_webview_window(SETTINGS_WINDOW) {
                report("show settings", show_settings_window(app, &settings));
            }
        }
        NEW_CHAT_ID => {
            if let Some(chat) = app.get_webview_window(CHAT_WINDOW) {
                if chat.is_focused().unwrap_or(false) {
                    report("emit new chat event", chat.emit(NEW_CHAT_EVENT, ()));
                }
            }
        }
        _ if id.starts_with(DOCK_ID_PREFIX) => {
            report("emit dock item event", app.emit_to(MAIN_WINDOW, DOCK_MENU_EVENT, &id[DOCK_ID_PREFIX.len()..]));
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

/// Lists the character's buttons under "动作", as pairs of key and label.
#[tauri::command]
fn sync_dock_menu(app: AppHandle, menu: State<'_, PetMenu>, items: Vec<(String, String)>) -> Result<(), String> {
    let valid = |(key, label): &(String, String)| !key.is_empty() && key.len() <= 80 && !label.is_empty() && label.chars().count() <= 40;
    if items.len() > MAX_DOCK_MENU_ITEMS || !items.iter().all(valid) {
        return Err("Invalid dock menu items".into());
    }
    let error = |error: tauri::Error| error.to_string();
    while menu.dock.remove_at(0).map_err(error)?.is_some() {}
    for (key, label) in &items {
        let item = MenuItem::with_id(&app, format!("{DOCK_ID_PREFIX}{key}"), label, true, None::<&str>).map_err(error)?;
        menu.dock.append(&item).map_err(error)?;
    }
    menu.dock.set_enabled(!items.is_empty()).map_err(error)
}

/// Opens the pet menu at the cursor. Called from the webview on right-click.
#[tauri::command]
fn show_pet_menu(app: AppHandle, window: WebviewWindow, menu: State<'_, PetMenu>) -> Result<(), String> {
    if menu.popped_up.swap(true, Ordering::Relaxed) {
        return Ok(());
    }
    // Returns once the menu is closed: the command is sync, so it runs on the main thread.
    let shown = show_pet_menu_native(&app, &window, &menu.menu);
    menu.popped_up.store(false, Ordering::Relaxed);
    shown.map_err(|error| format!("failed to open the pet menu: {error}"))
}

fn show_pet_menu_native(app: &AppHandle, window: &WebviewWindow, menu: &Menu<Wry>) -> tauri::Result<()> {
    #[cfg(not(target_os = "macos"))]
    let _ = app;

    #[cfg(target_os = "macos")]
    let settings_open = app
        .get_webview_window(SETTINGS_WINDOW)
        .is_some_and(|settings| settings.is_visible().unwrap_or(false));

    // A regular app can leave its non-activating pet panel behind the full-screen
    // space when a context menu is requested. The accessory policy is the one the
    // pet uses normally; restore Regular afterward so Settings stays in Dock/⌘Tab.
    #[cfg(target_os = "macos")]
    if settings_open {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory)?;
    }

    let shown = window.popup_menu(menu);

    #[cfg(target_os = "macos")]
    if settings_open {
        let restored = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        return shown.and(restored);
    }

    shown
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

/// Puts away, a moment later, every popover that does not have the focus. A popover only
/// hears that it lost the focus if it had it; one shown without it would otherwise stay up.
fn sweep_popovers(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(POPOVER_SWEEP_DELAY);
        for label in POPOVERS {
            if let Some(popover) = app.get_webview_window(label) {
                if popover.is_visible().unwrap_or(false) && !popover.is_focused().unwrap_or(false) {
                    report("hide popover without focus", popover.hide());
                }
            }
        }
    });
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
    if POPOVERS.contains(&label) {
        // They open in the same spot; one left behind without focus would never hear the click outside.
        for other in POPOVERS.iter().filter(|other| **other != label) {
            if let Some(other) = app.get_webview_window(other) {
                report("hide the other popover", other.hide());
            }
        }
        return floating_panel::take_keyboard(&window).map_err(|e| e.to_string());
    }
    show_settings_window(&app, &window).map_err(|e| e.to_string())
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
    diagnostics::log_panics();
    tauri::Builder::default()
        // First, so everything after it can log.
        .plugin(diagnostics::log_plugin())
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
        .manage(handover::Clipboard::default())
        .manage(translation::SelectionFloat::default())
        .manage(mail_code::MailCodeState::default())
        .manage(OnTopState(AtomicBool::new(true)))
        .manage(std::sync::Arc::new(llm::LlmState::default()))
        .manage(std::sync::Arc::new(mimo::MimoSpeechState::default()))
        .setup(|app| {
            // A desktop pet should not occupy a Dock slot.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Marks each launch in the log, so a problem can be placed before or after a restart.
            log::info!("AI Pet {} started", app.package_info().version);

            // Without the database the pet still runs; the work log and request records then report an error.
            let database = app.path().app_data_dir().map_err(|error| error.to_string()).and_then(|folder| database::Database::open(&folder));
            app.manage(database.unwrap_or_else(|error| {
                log::warn!("failed to open the database: {error}");
                database::Database::default()
            }));

            let pet_menu = build_menu(app)?;
            let (app_menu, new_chat) = build_app_menu(app)?;
            app.set_menu(app_menu)?;
            app.manage(NewChatItem(new_chat));
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
                let app_handle = app.handle().clone();
                settings.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        report("hide settings", hide_settings_window(&app_handle, &settings_handle));
                    }
                });
            }
            // The today and notes panels behave like popovers: they go away when they lose focus.
            for label in POPOVERS {
                if let Some(panel) = app.get_webview_window(label) {
                    #[cfg(target_os = "macos")]
                    floating_panel::apply_popover(&panel)?;
                    let handle = panel.clone();
                    let app_handle = app.handle().clone();
                    panel.on_window_event(move |event| match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            report("hide panel", handle.hide());
                        }
                        tauri::WindowEvent::Focused(false) => {
                            report("hide panel", handle.hide());
                            sweep_popovers(app_handle.clone());
                        }
                        _ => {}
                    });
                }
            }
            if let Some(chat_window) = app.get_webview_window(CHAT_WINDOW) {
                let handle = chat_window.clone();
                let app_handle = app.handle().clone();
                chat_window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(focused) = event {
                        if let Some(item) = app_handle.try_state::<NewChatItem>() {
                            report("enable new chat item", item.0.set_enabled(*focused));
                        }
                    }
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        // A running reply keeps going: closing only puts the window away.
                        // Recording and transcribing stop, since nobody is listening any more.
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
                        app_handle.state::<std::sync::Arc<llm::LlmState>>().cancel_window("translation");
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
            handover::start_watch(app.handle().clone());
            click_through::start(app.handle().clone(), MAIN_WINDOW);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_chat,
            open_today,
            open_notes,
            open_settings,
            set_pet_dnd,
            quick_chat::set_quick_chat_shortcut,
            quick_chat::set_translation_shortcut,
            translation::open_translation,
            handover::take_copied,
            translation::selection_status,
            translation::take_translation_selection,
            translation::set_selection_float,
            translation::translate_floating_selection,
            translation::expand_selection_float,
            translation::close_selection_float,
            quick_chat::take_pet_keyboard,
            quick_chat::release_pet_keyboard,
            llm::llm_key_status,
            llm::llm_save_key,
            llm::llm_clear_key,
            llm::llm_stream,
            llm::llm_complete,
            llm::llm_cancel,
            request_log::llm_log_put,
            request_log::llm_log_list,
            request_log::llm_log_clear,
            request_log::llm_stats_add,
            holidays::fetch_holiday_year,
            mail_code::mail_accounts,
            mail_code::mail_save_account,
            mail_code::mail_remove_account,
            mail_code::mail_code_cancel,
            mail_code::mail_code_try,
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
            sync_focus_menu,
            sync_dock_menu,
            alert::confirm_action,
            worklog::worklog_append,
            worklog::worklog_read,
            worklog::worklog_compact,
            worklog::worklog_add_counts,
            worklog::worklog_export,
            worklog::worklog_replace,
            diagnostics::diagnostics_log,
            diagnostics::diagnostics_read_logs,
            diagnostics::diagnostics_clear_logs,
            diagnostics::diagnostics_reveal_logs,
            diagnostics::diagnostics_export
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
