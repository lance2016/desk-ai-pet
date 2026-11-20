import { invoke, isTauri } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { availableMonitors, cursorPosition, getCurrentWindow, LogicalPosition, LogicalSize, primaryMonitor } from "@tauri-apps/api/window";
import type { ActionResult, ChatPhase, DockSide } from "../types";
import { z } from "zod";
import { clampWindowX, clampWindowY, dockSideAt, monitorUnderPet, offscreenInsets, snappedWindowX, verticalInsets, type MonitorBounds, type OffscreenInsets } from "./stageGeometry";

/** Must match SCALE_EVENT in src-tauri/src/lib.rs. */
const SCALE_EVENT = "pet://scale";
/** Must match the command name in src-tauri/src/lib.rs. */
const SHOW_MENU_COMMAND = "show_pet_menu";
/** Must match the command and event in src-tauri/src/click_through.rs. */
const SET_HIT_MASK_COMMAND = "set_hit_mask";
const GET_ON_TOP_COMMAND = "get_pet_on_top";
const SET_ON_TOP_COMMAND = "set_pet_on_top";
const REQUEST_SCALE_COMMAND = "request_pet_scale";
const HOVER_EVENT = "pet://hover";
const APPEARANCE_EVENT = "pet://appearance-changed";
const APPEARANCE_RESULT_EVENT = "pet://appearance-result";
const APPEARANCE_TIMEOUT_MS = 8000;
interface AppearanceRequest { id: string; requestId: string }
interface AppearanceResult { requestId: string; error?: string }
const ACTION_EVENT = "pet://request-action";
const CHAT_ACTION_EVENT = "pet://chat-action";
const CHAT_ACTION_RESULT_EVENT = "pet://chat-action-result";
const CHAT_ACTION_TIMEOUT_MS = 1500;
const chatActionSchema = z.object({ id: z.string(), requestId: z.string(), source: z.enum(["main", "chat"]) });
const CHAT_PHASE_EVENT = "pet://chat-phase";
const ON_TOP_EVENT = "pet://on-top";
/** Must match DND_EVENT and the commands in src-tauri/src/lib.rs. */
const DND_EVENT = "pet://dnd";
const SET_DND_COMMAND = "set_pet_dnd";
const OPEN_TODAY_COMMAND = "open_today";
const OPEN_NOTES_COMMAND = "open_notes";
const OPEN_SETTINGS_COMMAND = "open_settings";
const SETTINGS_SECTION_EVENT = "pet://settings-section";
/** Must match the event and commands in src-tauri/src/quick_chat.rs. */
const QUICK_CHAT_EVENT = "pet://quick-chat";
const SET_QUICK_CHAT_SHORTCUT_COMMAND = "set_quick_chat_shortcut";
const TAKE_KEYBOARD_COMMAND = "take_pet_keyboard";
const RELEASE_KEYBOARD_COMMAND = "release_pet_keyboard";
/** "摸摸头" in the pet menu. Must match PAT_EVENT in src-tauri/src/lib.rs. */
const PAT_EVENT = "pet://pat";
/** "今日回顾" in the pet menu. Must match REVIEW_EVENT in src-tauri/src/lib.rs. */
const REVIEW_EVENT = "pet://review";
/** Must match REVEALED_EVENT, FOCUS_EVENT and the commands in src-tauri/src/lib.rs. */
const REVEALED_EVENT = "pet://revealed";
const FOCUS_EVENT = "pet://focus";
const SHOW_PET_COMMAND = "show_pet";
const SYNC_FOCUS_MENU_COMMAND = "sync_focus_menu";
/** The character's buttons under "动作" in the pet menu. Must match `src-tauri/src/lib.rs`. */
const SYNC_DOCK_MENU_COMMAND = "sync_dock_menu";
const DOCK_MENU_EVENT = "pet://dock-item";
/** Asks the today panel to open one item for editing; sent between webviews only. */
const TODAY_ITEM_EVENT = "pet://today-item";
/** Asks the notes panel to point out one note; sent between webviews only. */
const NOTE_EVENT = "pet://note";
/** Asks the chat window to show one thread; sent between webviews only. */
const CHAT_THREAD_EVENT = "pet://chat-thread";
/** Like `CHAT_THREAD_EVENT`, and the chat window also answers the thread's last, unanswered message. */
const CHAT_RESUME_EVENT = "pet://chat-resume";
const MORNING_TEST_EVENT = "pet://morning-greeting-test";
const MORNING_TEST_RESULT_EVENT = "pet://morning-greeting-test-result";
const MORNING_TEST_TIMEOUT_MS = 45_000;
interface MorningTestRequest { requestId: string }
interface MorningTestResult { requestId: string; error?: string }

/** A point in logical screen pixels, from the top left of the main screen. */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** The pet window's last position, so it comes back where the user left it. Global; backups include it. */
const POSITION_KEY = "ai-pet:window-position:v1";
const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

/** A monitor with its usable area: without the menu bar and the Dock. */
interface Screen extends MonitorBounds {
  usable: { top: number; bottom: number };
}

interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The monitor the pet is on. */
  monitor: Screen;
  monitors: Screen[];
}

async function readFrame(): Promise<WindowFrame | null> {
  const window = getCurrentWindow();
  const [monitors, position, size, scale] = await Promise.all([
    availableMonitors(),
    window.outerPosition(),
    window.outerSize(),
    window.scaleFactor(),
  ]);
  const frame = { x: position.x / scale, y: position.y / scale, width: size.width / scale, height: size.height / scale };
  // Each monitor in its own scale: physical pixels of screens with different scales cannot be compared.
  const screens = monitors.map((each): Screen => {
    const left = each.position.x / each.scaleFactor;
    const top = each.position.y / each.scaleFactor;
    const usableTop = each.workArea.position.y / each.scaleFactor;
    return {
      left,
      top,
      right: left + each.size.width / each.scaleFactor,
      bottom: top + each.size.height / each.scaleFactor,
      usable: { top: usableTop, bottom: usableTop + each.workArea.size.height / each.scaleFactor },
    };
  });
  // Not `currentMonitor()`: right after a drag to another screen it still names the old one, and the pet jumps back.
  const monitor = monitorUnderPet(frame, screens);
  return monitor ? { ...frame, monitor, monitors: screens } : null;
}

/** Listens to an event from the native side. Returns an unsubscribe function. */
function subscribe<Payload>(name: string, handler: (payload: Payload) => void): () => void {
  if (!isTauri()) return () => {};
  const unlisten = listen<Payload>(name, (event) => handler(event.payload));
  return () => {
    unlisten.then((stop) => stop()).catch((error) => console.error(`Failed to stop listening for ${name}`, error));
  };
}

/**
 * Everything that touches the native window lives here. In a plain browser
 * (`pnpm dev` without Tauri) these calls do nothing, so the pet still runs.
 */
export const petWindow = {
  /** False in a plain browser, where there is no native window to control. */
  isNative: isTauri(),

  /**
   * Tells the native side which cells of the window take mouse input; the
   * mouse passes through everything else.
   */
  async setHitMask(cell: number, columns: number, cells: boolean[]): Promise<void> {
    if (!isTauri()) return;
    await invoke(SET_HIT_MASK_COMMAND, { cell, columns, cells });
  },

  /** Calls `handler` when the cursor moves onto or off the parts that take mouse input. */
  onHoverChanged(handler: (hovered: boolean) => void): () => void {
    return subscribe<boolean>(HOVER_EVENT, handler);
  },

  /** Top-left corner of the window, or null when there is no native window. */
  async getPosition(): Promise<ScreenPoint | null> {
    if (!isTauri()) return null;
    const window = getCurrentWindow();
    const [position, scale] = await Promise.all([window.outerPosition(), window.scaleFactor()]);
    return { x: position.x / scale, y: position.y / scale };
  },

  /**
   * The cursor, in the same units as `getPosition`. Dragging must not use `PointerEvent.screenY`:
   * WebKit measures it from the top of the screen the window is on, so it jumps by a whole screen
   * when the window crosses onto a screen above or below, and the pet bounces between the two.
   */
  async getCursor(): Promise<ScreenPoint | null> {
    if (!isTauri()) return null;
    const [cursor, primary] = await Promise.all([cursorPosition(), primaryMonitor()]);
    // tao converts the cursor with the main screen's scale, whichever screen it is on.
    const scale = primary?.scaleFactor ?? 1;
    return { x: cursor.x / scale, y: cursor.y / scale };
  },

  async setPosition(point: ScreenPoint): Promise<void> {
    if (!isTauri()) return;
    await getCurrentWindow().setPosition(new LogicalPosition(point.x, point.y));
  },

  async setSize(width: number, height: number): Promise<void> {
    if (!isTauri()) return;
    await getCurrentWindow().setSize(new LogicalSize(width, height));
  },

  async requestAction(id: string): Promise<void> {
    if (!isTauri()) throw new Error("Action preview requires the desktop app");
    await emitTo("main", ACTION_EVENT, id);
  },

  async notifyAppearanceChanged(id: string): Promise<void> {
    if (!isTauri()) throw new Error("Desktop pet is not connected");
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let finish!: (result: AppearanceResult) => void;
    const response = new Promise<AppearanceResult>((resolve) => { finish = resolve; });
    const unlisten = await listen<AppearanceResult>(APPEARANCE_RESULT_EVENT, (event) => {
      if (event.payload?.requestId === requestId) finish(event.payload);
    });
    const timer = setTimeout(() => finish({ requestId, error: "Desktop pet did not respond" }), APPEARANCE_TIMEOUT_MS);
    try {
      await emitTo("main", APPEARANCE_EVENT, { id, requestId } satisfies AppearanceRequest);
      const result = await response;
      if (result.error) throw new Error(result.error);
    } finally { clearTimeout(timer); unlisten(); }
  },

  async testMorningGreeting(): Promise<void> {
    if (!isTauri()) throw new Error("早安问候测试仅在桌面应用中可用");
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let finish!: (result: MorningTestResult) => void;
    const response = new Promise<MorningTestResult>((resolve) => { finish = resolve; });
    const unlisten = await listen<MorningTestResult>(MORNING_TEST_RESULT_EVENT, (event) => {
      if (event.payload?.requestId === requestId) finish(event.payload);
    });
    const timer = setTimeout(() => finish({ requestId, error: "宠物没有响应，请稍后再试。" }), MORNING_TEST_TIMEOUT_MS);
    try {
      await emitTo("main", MORNING_TEST_EVENT, { requestId } satisfies MorningTestRequest);
      const result = await response;
      if (result.error) throw new Error(result.error);
    } finally { clearTimeout(timer); unlisten(); }
  },

  onMorningGreetingTest(handler: (request: MorningTestRequest) => void): () => void {
    return subscribe<MorningTestRequest>(MORNING_TEST_EVENT, handler);
  },

  async reportMorningGreetingTest(result: MorningTestResult): Promise<void> {
    if (!isTauri()) return;
    await emitTo("settings", MORNING_TEST_RESULT_EVENT, result);
  },

  onAppearanceChanged(handler: (request: AppearanceRequest) => void): () => void {
    return subscribe<AppearanceRequest>(APPEARANCE_EVENT, handler);
  },

  async reportAppearanceResult(result: AppearanceResult): Promise<void> {
    if (!isTauri()) return;
    await emitTo("settings", APPEARANCE_RESULT_EVENT, result);
  },

  onActionRequested(handler: (id: string) => void): () => void {
    return subscribe<string>(ACTION_EVENT, handler);
  },

  /** Resolves when the pet accepts or rejects scheduling, without waiting for playback. */
  async requestChatAction(id: string, requestId: string): Promise<ActionResult> {
    if (!isTauri()) return { accepted: false, reason: "unavailable" };
    const source = getCurrentWindow().label;
    let finish!: (result: ActionResult) => void;
    const response = new Promise<ActionResult>((resolve) => { finish = resolve; });
    const unlisten = await listen<{ requestId: string; result: ActionResult }>(CHAT_ACTION_RESULT_EVENT, ({ payload }) => {
      if (payload?.requestId === requestId) finish(payload.result);
    });
    const timer = setTimeout(() => finish({ accepted: false, reason: "unavailable" }), CHAT_ACTION_TIMEOUT_MS);
    try {
      await emitTo("main", CHAT_ACTION_EVENT, { id, requestId, source });
      return await response;
    } finally { clearTimeout(timer); unlisten(); }
  },

  onChatActionRequested(handler: (id: string, report: (result: ActionResult) => void) => void): () => void {
    return subscribe<unknown>(CHAT_ACTION_EVENT, (payload) => {
      const parsed = chatActionSchema.safeParse(payload);
      if (!parsed.success) return;
      const { id, requestId, source } = parsed.data;
      handler(id, (result) => {
        void emitTo(source, CHAT_ACTION_RESULT_EVENT, { requestId, result })
          .catch((error: unknown) => console.warn("Could not report the requested action result", error));
      });
    });
  },

  /** Tells the pet where a conversation in the calling window stands, so it can think along and keep the user company. */
  async reportChatPhase(phase: ChatPhase): Promise<void> {
    if (!isTauri()) return;
    await emitTo("main", CHAT_PHASE_EVENT, phase);
  },

  /** For the pet window. The payload comes from another window, so it is not trusted to be a known phase. */
  onChatPhase(handler: (phase: unknown) => void): () => void {
    return subscribe<unknown>(CHAT_PHASE_EVENT, handler);
  },

  /**
   * Keeps the pet on the monitor it is on (the nearest one, if its screen is
   * gone); the empty margins may hang off screen.
   */
  async constrainToMonitor(): Promise<void> {
    if (!isTauri()) return;
    const frame = await readFrame();
    if (!frame) return;
    const x = clampWindowX(frame.x, frame.width, frame.monitor);
    const y = clampWindowY(frame.y, frame.height, frame.monitor);
    if (x !== frame.x || y !== frame.y) await this.setPosition({ x, y });
  },

  /** The screen edge the pet has been pushed against or past, if any. A seam to another monitor does not count. */
  async dockSide(): Promise<DockSide | null> {
    if (!isTauri()) return null;
    const frame = await readFrame();
    return frame ? dockSideAt(frame.x, frame.width, frame.monitor, frame.monitors) : null;
  },

  /** How far the window sticks out of sight, so overlays can stay visible. */
  async offscreenInsets(): Promise<OffscreenInsets> {
    const none = { left: 0, right: 0, top: 0, bottom: 0 };
    if (!isTauri()) return none;
    const frame = await readFrame();
    return frame ? { ...offscreenInsets(frame.x, frame.width, frame.monitor), ...verticalInsets(frame.y, frame.height, frame.monitor.usable) } : none;
  },

  /** Remembers where the pet is, after the user moved it. */
  async savePosition(): Promise<void> {
    const position = await this.getPosition();
    if (!position) return;
    try { window.localStorage.setItem(POSITION_KEY, JSON.stringify(position)); } catch (error) { console.warn("Could not save the pet position", error); }
  },

  /** Puts the pet back where it was last left, kept on a screen that still exists. Resolves to whether it moved. */
  async restorePosition(): Promise<boolean> {
    if (!isTauri()) return false;
    let saved: ScreenPoint;
    try {
      const raw = window.localStorage.getItem(POSITION_KEY);
      if (!raw) return false;
      saved = positionSchema.parse(JSON.parse(raw));
    } catch (error) {
      console.warn("Ignoring the saved pet position", error);
      return false;
    }
    await this.setPosition(saved);
    await this.constrainToMonitor();
    return true;
  },

  /**
   * Calls `handler` when the window may have ended up somewhere else without a
   * drag: moved by macOS after a display was unplugged or rearranged, or on a
   * screen with another scale.
   */
  onDisplayChanged(handler: () => void): () => void {
    if (!isTauri()) return () => {};
    const window = getCurrentWindow();
    const stops = [window.onScaleChanged(() => handler()), window.onMoved(() => handler())];
    return () => { for (const stop of stops) stop.then((unlisten) => unlisten()).catch((error) => console.error("Failed to stop listening for display changes", error)); };
  },

  /** Moves the window so the pet is flush against a screen edge. */
  async snapToEdge(side: DockSide): Promise<void> {
    if (!isTauri()) return;
    const frame = await readFrame();
    if (!frame) return;
    const x = snappedWindowX(side, frame.width, frame.monitor);
    if (Math.abs(x - frame.x) >= 1) await this.setPosition({ x, y: frame.y });
  },

  /** Puts the calling window away, as Esc does in the reminders and notes panels. */
  async hideSelf(): Promise<void> {
    if (!isTauri()) return;
    await getCurrentWindow().hide();
  },

  /** Sets the title of the calling window, such as the chat window's "和小艾聊天". */
  async setTitle(title: string): Promise<void> {
    if (!isTauri()) { document.title = title; return; }
    await getCurrentWindow().setTitle(title);
  },

  /** Opens the chat window, on `threadId` if given; `resume` also has it answer that thread's last message. */
  async openChat(threadId?: string, resume = false): Promise<void> {
    if (!isTauri()) { window.open("/?window=chat", "_blank"); return; }
    if (threadId) await emitTo("chat", resume ? CHAT_RESUME_EVENT : CHAT_THREAD_EVENT, threadId);
    await invoke("open_chat");
  },

  /** Calls `handler` with the thread whose last message the chat window should answer. */
  onChatResumeRequested(handler: (threadId: string) => void): () => void {
    return subscribe<string>(CHAT_RESUME_EVENT, handler);
  },

  /** Calls `handler` with the thread another window asked the chat window to show. */
  onChatThreadRequested(handler: (threadId: string) => void): () => void {
    return subscribe<string>(CHAT_THREAD_EVENT, handler);
  },

  /** Registers the global quick chat shortcut, or removes it with `null`. Rejects when another app holds it. */
  async setQuickChatShortcut(shortcut: string | null): Promise<void> {
    if (!isTauri()) return;
    await invoke(SET_QUICK_CHAT_SHORTCUT_COMMAND, { shortcut });
  },

  /** Calls `handler` when "摸摸头" is picked in the pet menu. */
  onPatRequested(handler: () => void): () => void {
    return subscribe<null>(PAT_EVENT, () => handler());
  },

  /** Calls `handler` when "今日回顾" is picked in the pet menu. */
  onReviewRequested(handler: () => void): () => void {
    return subscribe<null>(REVIEW_EVENT, () => handler());
  },

  /** Calls `handler` when the quick chat shortcut is pressed. */
  onQuickChatRequested(handler: () => void): () => void {
    return subscribe<null>(QUICK_CHAT_EVENT, () => handler());
  },

  /** Lets the pet window take typing without bringing the app to the front. */
  async takeKeyboard(): Promise<void> {
    if (!isTauri()) return;
    await invoke(TAKE_KEYBOARD_COMMAND);
  },

  /** Hands typing back to the app the user was in. */
  async releaseKeyboard(): Promise<void> {
    if (!isTauri()) return;
    await invoke(RELEASE_KEYBOARD_COMMAND);
  },

  /** Opens the settings window, optionally on one section such as "ai". */
  async openSettings(section?: string): Promise<void> {
    if (!isTauri()) { window.open(`/?window=settings${section ? `&section=${section}` : ""}`, "_blank"); return; }
    await invoke(OPEN_SETTINGS_COMMAND, { section: section ?? null });
  },

  /** Calls `handler` with the section another window asked the settings window to show. */
  onSettingsSection(handler: (section: string) => void): () => void {
    return subscribe<string>(SETTINGS_SECTION_EVENT, handler);
  },

  /** Opens the small "today" panel next to the pet, editing `itemId` when given (e.g. one the AI just added). */
  async openToday(itemId?: string): Promise<void> {
    if (!isTauri()) { window.open("/?window=today", "_blank"); return; }
    if (itemId) await emitTo("today", TODAY_ITEM_EVENT, itemId);
    await invoke(OPEN_TODAY_COMMAND);
  },

  /** Calls `handler` with the item another window asked the today panel to edit. */
  onTodayItemRequested(handler: (itemId: string) => void): () => void {
    return subscribe<string>(TODAY_ITEM_EVENT, handler);
  },

  /** Opens the notes panel next to the pet, pointing out `noteId` when given (e.g. one the AI just saved). */
  async openNotes(noteId?: string): Promise<void> {
    if (!isTauri()) { window.open("/?window=notes", "_blank"); return; }
    if (noteId) await emitTo("notes", NOTE_EVENT, noteId);
    await invoke(OPEN_NOTES_COMMAND);
  },

  /** Calls `handler` with the note another window asked the notes panel to point out. */
  onNoteRequested(handler: (noteId: string) => void): () => void {
    return subscribe<string>(NOTE_EVENT, handler);
  },

  /** Ticks "勿扰" in the pet menu and tells every window. */
  async setDoNotDisturb(enabled: boolean): Promise<void> {
    if (!isTauri()) return;
    await invoke(SET_DND_COMMAND, { enabled });
  },

  /** Calls `handler` when do-not-disturb is switched in the pet menu. */
  onDoNotDisturbChanged(handler: (enabled: boolean) => void): () => void {
    return subscribe<boolean>(DND_EVENT, handler);
  },

  /** Shows the pet if it was hidden from the menu, without taking the keyboard; for a reminder that came due. */
  async showPet(): Promise<void> {
    if (!isTauri()) return;
    await invoke(SHOW_PET_COMMAND);
  },

  /** Calls `handler` when the pet was shown again (menu, Dock icon, a reminder), to keep it on a screen. */
  onRevealed(handler: () => void): () => void {
    return subscribe<null>(REVEALED_EVENT, () => handler());
  },

  /** Names the menu's focus item after the current phase: "开始专注", "停止专注" or "结束休息". */
  async syncFocusMenu(phase: "off" | "focusing" | "resting"): Promise<void> {
    if (!isTauri()) return;
    await invoke(SYNC_FOCUS_MENU_COMMAND, { phase });
  },

  /** Lists the character's buttons under "动作" in the pet menu, as pairs of key and label. */
  async syncDockMenu(items: Array<[key: string, label: string]>): Promise<void> {
    if (!isTauri()) return;
    await invoke(SYNC_DOCK_MENU_COMMAND, { items });
  },

  /** Calls `handler` with the key of the button picked under "动作" in the pet menu. */
  onDockMenu(handler: (key: string) => void): () => void {
    return subscribe<string>(DOCK_MENU_EVENT, handler);
  },

  /** Calls `handler` with true to start a round, false to stop the round or the rest, when the menu item is picked. */
  onFocusMenu(handler: (start: boolean) => void): () => void {
    return subscribe<boolean>(FOCUS_EVENT, handler);
  },

  /** Opens the native pet menu (show/hide, always on top, size, quit) at the cursor. */
  async showMenu(): Promise<void> {
    if (!isTauri()) return;
    await invoke(SHOW_MENU_COMMAND);
  },

  async getOnTop(): Promise<boolean> {
    if (!isTauri()) return true;
    return invoke<boolean>(GET_ON_TOP_COMMAND);
  },

  onOnTopChanged(handler: (enabled: boolean) => void): () => void {
    return subscribe<boolean>(ON_TOP_EVENT, handler);
  },

  async setOnTop(enabled: boolean): Promise<void> {
    if (!isTauri()) return;
    await invoke(SET_ON_TOP_COMMAND, { enabled });
  },

  async requestScale(scale: number): Promise<void> {
    if (!isTauri()) return;
    await invoke(REQUEST_SCALE_COMMAND, { scale });
  },

  /** Calls `handler` when a pet size is picked in the pet menu. Returns an unsubscribe function. */
  onScaleRequested(handler: (scale: number) => void): () => void {
    return subscribe<number>(SCALE_EVENT, handler);
  },
};
