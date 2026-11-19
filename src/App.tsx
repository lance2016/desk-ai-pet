import { loadSelectionFloat } from "./preferences/SelectionFloat";
import { ai } from "./ai";
import { translationPlatform } from "./platform/translation";
import { loadTranslationShortcut } from "./preferences/TranslationShortcut";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import "./App.css";
import { dueReminders, loadAgenda, markReminded, setAgendaItemDone, snoozeReminders, subscribeAgenda, updateAgenda, type AgendaItem } from "./agenda/AgendaStore";
import { agendaChange, hasNewId } from "./agenda/changes";
import { localTimeText } from "./agenda/chatTools";
import { refreshHolidays } from "./agenda/Workdays";
import { loadNotes, subscribeNotes } from "./notes/NoteStore";
import type { ReminderSource } from "./behavior/BehaviorEngine";
import { loadFocusLog, recordFocusRound } from "./greeting/FocusLog";
import { collectFacts } from "./greeting/GreetingContent";
import { Greeter } from "./greeting/Greeter";
import { Companion } from "./behavior/Companion";
import { loadCompanionPreferences } from "./preferences/CompanionPreferences";
import { loadGreetingRecord, saveGreetingRecord } from "./greeting/GreetingSchedule";
import { loadThreads, recordThread, saveThreads } from "./chat/ChatThreads";
import { holidayPlatform } from "./platform/holidays";
import { requestPreferences } from "./preferences/ChatPreferences";
import { isOnboarded, markOnboarded } from "./preferences/UserProfile";
import { PetControls } from "./components/PetControls";
import { QuickChatBar, QuickReplyBubble, useQuickChat } from "./components/QuickChat";
import { PetSpeech } from "./components/PetSpeech";
import { PetStage } from "./components/PetStage";
import { PetRuntime } from "./core/PetRuntime";
import { loadCharacterPack } from "./assets/PackCatalog";
import { loadUserActions } from "./actions/UserActions";
import { applyLaunchAtLoginDefault } from "./preferences/LaunchAtLogin";
import { systemPlatform } from "./platform/system";
import { composeHitMask, HIT_CELL_PX, maskToElement, type MaskRect } from "./platform/hitMask";
import { saveActiveCharacter } from "./preferences/CharacterPreferences";
import { DEFAULT_PACK_ID } from "./assets/PackCatalog";
import { petWindow } from "./platform/petWindow";
import { mailCodePlatform } from "./platform/mailCode";
import { STAGE_MARGIN, stageSize, type OffscreenInsets } from "./platform/stageGeometry";
import { PixiRenderer } from "./renderer/PixiRenderer";
import { loadDisplayPreferences, loadOnTop, saveOnTop, subscribeDisplayPreferences } from "./preferences/DisplayPreferences";
import { isQuietAt, loadQuietPreferences, saveQuietPreferences } from "./preferences/QuietPreferences";
import { loadQuickChatShortcut, quickChatShortcutLabel } from "./preferences/QuickChatPreferences";
import { recordActionTrigger } from "./preferences/ActionTriggerStats";
import { createLocalPetStorage } from "./storage/PetStorage";
import { loadFocus, saveFocus } from "./storage/FocusStorage";
import type { FocusSnapshot } from "./behavior/FocusTimer";
import { updaterPlatform } from "./platform/updater";
import { startUpdateChecks } from "./update/UpdateNotice";
import { announceUpdate, skipWhatsNew } from "./update/WhatsNew";
import { CHAT_PHASES } from "./types";

const DEFAULT_SCALE = 1;
/** Set once the pet has told a new user how to play with it. */
const INTRO_KEY = "ai-pet:intro-tips:v1";
const INTRO_LINES = ["点我一下就能聊天", "按住我是摸摸头，右键还有更多"];
/** What "今日回顾" in the pet menu asks in a new chat; the model looks up today's record to answer it. */
const REVIEW_REQUEST = "帮我回顾一下今天，写成能直接贴进日报的几条。";

/** Set when a character could not be loaded and the default one stands in; the pet says so once it is up. */
let fallbackNotice: string | null = null;
/** Cells the clickable area extends past the drawing, to cover its motion. */
const HIT_GROW_CELLS = 2;
/** Wait for layout and the renderer to settle before measuring the mask. */
const HIT_MASK_DELAY_MS = 30;
/** Moves come in bursts while macOS rearranges windows; act once they stop. */
const DISPLAY_SETTLE_MS = 500;
/** How often to see whether a morning or evening greeting is due. */
const GREETING_CHECK_MS = 15_000;
/** How often to read how long the keyboard and mouse have been idle: for the pet's naps and the companion's care. */
const ACTIVITY_CHECK_MS = 10_000;
/** How often to see whether a missing year of holiday data can be downloaded; it is looked up once a day. */
const HOLIDAY_CHECK_MS = 60 * 60_000;

/**
 * The agenda shared by every window, read again only after a window changed it:
 * the pet checks it every second, and parsing it each time is wasted work.
 */
let agendaCache: AgendaItem[] | null = null;
let agendaWatched = false;
function cachedAgenda(): AgendaItem[] {
  if (!agendaWatched) {
    agendaWatched = true;
    subscribeAgenda(() => { agendaCache = null; });
  }
  agendaCache ??= loadAgenda();
  return agendaCache;
}

function changeAgenda(change: (items: AgendaItem[]) => AgendaItem[], failure: string): void {
  try {
    agendaCache = updateAgenda(change);
  } catch (error) {
    console.error(failure, error);
  }
}

const REMINDERS: ReminderSource = {
  due: (now) => dueReminders(cachedAgenda(), now),
  markReminded: (ids, now) => changeAgenda((items) => markReminded(items, ids, now), "Failed to save that a reminder was shown"),
  complete: (ids, now) => changeAgenda((items) => ids.reduce((list, id) => setAgendaItemDone(list, id, true, now), items), "Failed to tick off reminders"),
  snooze: (ids, until, now) => changeAgenda((items) => snoozeReminders(items, ids, now, until), "Failed to snooze reminders"),
};
const isQuiet = (now: number) => isQuietAt(loadQuietPreferences(), now);
/** Reminders the user timed come even in quiet hours; only "勿扰" holds them back. */
const holdsReminders = () => loadQuietPreferences().doNotDisturb;
const FOCUS_STORE = { load: () => loadFocus(), save: (snapshot: FocusSnapshot) => saveFocus(snapshot) };

/** True while `active` is true, and for `delayMs` after it turns false. */
function useLingering(active: boolean, delayMs: number): boolean {
  const [lingering, setLingering] = useState(active);
  useEffect(() => {
    if (active) {
      setLingering(true);
      return;
    }
    const timer = setTimeout(() => setLingering(false), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active || lingering;
}

interface AppProps {
  /** Character to show. The window remounts this component when it changes. */
  packId: string;
}

export default function App({ packId }: AppProps) {
  const storage = useMemo(() => createLocalPetStorage(window.localStorage, packId), [packId]);
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  /** Bumped when the standing bubble or the badge comes or goes; their boxes go into the clickable area. */
  const [speechLayout, setSpeechLayout] = useState(0);
  const onSpeechLayout = useCallback(() => setSpeechLayout((count) => count + 1), []);
  const quickBarRef = useRef<HTMLFormElement>(null);
  const quickReplyRef = useRef<HTMLDivElement>(null);
  /** Text of the standing reminder bubble, which must take clicks while it is up. */
  const [alert, setAlert] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<PetRuntime | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadErrorRef = useRef<HTMLParagraphElement>(null);
  const [scale, setScale] = useState(() => storage.loadScale() ?? DEFAULT_SCALE);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dockSide, setDockSide] = useState<"left" | "right" | null>(null);
  const [insets, setInsets] = useState<OffscreenInsets>({ left: 0, right: 0, top: 0, bottom: 0 });
  /** For display-change callbacks, which outlive a render. */
  const placement = useRef({ dragging, dockSide });
  placement.current = { dragging, dockSide };
  /** Resolves to whether the saved position was restored for the character being loaded. */
  const restoredPosition = useRef<Promise<boolean> | null>(null);
  const [displayPreferences, setDisplayPreferences] = useState(loadDisplayPreferences);
  const quickChat = useQuickChat(runtime, packId);
  const quickReplyShown = quickChat.reply !== null;
  const controlsVisible = useLingering(hovered, displayPreferences.controlsLingerMs) && !dragging && !quickChat.open && !dockSide;
  const petBox = runtime
    ? { width: Math.round(runtime.manifest.canvas.width * runtime.manifest.scale * scale), height: Math.round(runtime.manifest.canvas.height * runtime.manifest.scale * scale) }
    : { width: 0, height: 0 };
  const refreshInsets = useCallback(() => {
    petWindow.offscreenInsets().then(setInsets).catch((error) => console.warn("Failed to measure the window position", error));
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new PixiRenderer(host);
    let cancelled = false;
    let created: PetRuntime | null = null;
    // Back where the user left it, before the pet is drawn, so the move is not seen.
    restoredPosition.current = petWindow.restorePosition().catch((error: unknown) => { console.warn("Could not restore the pet position", error); return false; });

    loadCharacterPack(packId)
      .then((pack) => PetRuntime.create({ renderer, storage, pack, reminders: REMINDERS, isQuiet, holdsReminders, focusStore: FOCUS_STORE, userActions: () => loadUserActions(packId), onActionStarted: (actionId) => recordActionTrigger(packId, actionId) }))
      .then((instance) => {
        if (cancelled) {
          instance.destroy();
          return;
        }
        created = instance;
        setRuntime(instance);
        if (fallbackNotice) { instance.say(fallbackNotice); fallbackNotice = null; }
        // Lets you try `__pet.requestAction("happy")` from the dev console.
        if (import.meta.env.DEV) Object.assign(window, { __pet: instance });
      })
      .catch((error: unknown) => {
        console.error("Failed to start the pet", error);
        renderer.destroy();
        if (cancelled) return;
        // A character that cannot be read (deleted, broken) gives way to the default one.
        if (packId !== DEFAULT_PACK_ID) {
          try {
            fallbackNotice = "原来的角色读不出来了，先换回默认角色。可以在设置 → 角色里重新选。";
            saveActiveCharacter(DEFAULT_PACK_ID);
            return;
          } catch (reason) { console.error("Could not switch back to the default character", reason); }
        }
        setLoadError("宠物没能显示出来。可以试试从菜单栏图标退出后重新打开 AI Pet。");
      });

    return () => {
      cancelled = true;
      created?.destroy();
      setRuntime(null);
    };
  }, [packId, storage]);

  // The installed app opens at login by default. A dev build would register the dev binary, so it is left alone.
  useEffect(() => {
    if (!systemPlatform.isNative || import.meta.env.DEV) return;
    applyLaunchAtLoginDefault(systemPlatform.setLaunchAtLogin)
      .catch((error: unknown) => console.warn("Could not turn on opening at login", error));
  }, []);

  // First launch without a DeepSeek key: open settings, which shows the welcome guide.
  useEffect(() => {
    if (isOnboarded() || !petWindow.isNative) return;
    ai.keyStatus()
      .then((saved) => { if (saved) markOnboarded(); else return petWindow.openSettings(); })
      .catch((error: unknown) => console.warn("Could not start the welcome guide", error));
  }, []);

  // The first time the pet is up, it says how to play with it. Once only, whoever set the key up.
  // Later starts after an update, it says once that it was updated instead.
  useEffect(() => {
    if (!runtime) return;
    try {
      if (window.localStorage.getItem(INTRO_KEY) !== null) {
        announceUpdate(window.localStorage, (text) => runtime.sayProactively(text));
        return;
      }
      window.localStorage.setItem(INTRO_KEY, String(Date.now()));
      skipWhatsNew(window.localStorage);
    } catch (error) {
      console.warn("Could not remember the intro tips", error);
      return;
    }
    for (const line of INTRO_LINES) runtime.say(line);
  }, [runtime]);

  // Mentions a newer version now and then. Not in development: there is nothing installed to replace.
  useEffect(() => {
    if (!runtime || !updaterPlatform.isNative || import.meta.env.DEV) return;
    return startUpdateChecks({ check: () => updaterPlatform.check(), say: (text) => runtime.sayProactively(text), storage: window.localStorage });
  }, [runtime]);

  // Ticks the saved size in the pet menu, which starts on the standard one.
  useEffect(() => {
    void petWindow.requestScale(storage.loadScale() ?? DEFAULT_SCALE).catch((error: unknown) => console.warn("Could not tick the pet size in the menu", error));
  }, [storage]);

  useEffect(() => {
    return petWindow.onScaleRequested((next) => {
      storage.saveScale(next);
      setScale(next);
    });
  }, [storage]);

  useEffect(() => {
    if (!runtime) return;
    const stops = [
      runtime.bus.on("pet.drag_started", () => setDragging(true)),
      runtime.bus.on("pet.drag_ended", () => {
        setDragging(false);
        refreshInsets();
        void petWindow.savePosition().catch((error: unknown) => console.warn("Could not save the pet position", error));
      }),
      runtime.bus.on("pet.alert", ({ text }) => {
        setAlert(text);
        // A reminder must be seen even when the pet was hidden from the menu.
        if (text) void petWindow.showPet().catch((error: unknown) => console.warn("Could not show the pet for a reminder", error));
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [runtime, refreshInsets]);

  useEffect(() => {
    const saved = loadOnTop();
    if (saved !== null) void petWindow.setOnTop(saved).catch((error) => console.warn("Failed to restore on-top setting", error));
    return petWindow.onOnTopChanged((value) => { try { saveOnTop(value); } catch (error) { console.warn("Failed to save on-top setting", error); } });
  }, []);

  // Morning and evening greetings, and the focus rounds they mention.
  useEffect(() => {
    if (!runtime) return;
    const greeter = new Greeter({
      loadQuiet: () => loadQuietPreferences(),
      loadRecord: () => loadGreetingRecord(),
      saveRecord: (record) => saveGreetingRecord(record),
      facts: (now) => collectFacts(loadAgenda(), loadFocusLog(), now),
      compose: (kind, lines, now) => ai.greet(kind, lines, requestPreferences(packId, runtime.manifest.persona), localTimeText(now)),
      greet: (text) => runtime.greet(text),
    });
    const check = () => { greeter.check(Date.now()).catch((error: unknown) => console.error("Failed to greet", error)); };
    check();
    const timer = setInterval(check, GREETING_CHECK_MS);
    const stopFocusLog = runtime.bus.on("pet.focus_completed", () => {
      try { recordFocusRound(Date.now()); } catch (error) { console.warn("Failed to record the focus round", error); }
    });
    return () => {
      clearInterval(timer);
      stopFocusLog();
    };
  }, [runtime, packId]);

  useEffect(() => {
    if (!runtime) return;
    const companion = new Companion(window.localStorage, (text, allowQuiet) => runtime.greet(text, Boolean(allowQuiet) && !loadQuietPreferences().doNotDisturb));
    let active = true;
    let pending = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      try {
        const idle = await systemPlatform.idleSeconds();
        if (active && idle !== null) {
          const now = Date.now();
          runtime.bus.emit("pet.user_active", { at: now - idle * 1000 });
          companion.check(now, idle, loadCompanionPreferences(), runtime.focus.get().phase === "focusing");
        }
      } catch (error) { console.warn("Could not check system activity", error); }
      finally { pending = false; }
    };
    void check();
    const timer = setInterval(() => void check(), ACTIVITY_CHECK_MS);
    return () => { active = false; clearInterval(timer); };
  }, [runtime]);

  // Working-day reminders need each year's official holidays; fetch a year once it is published.
  useEffect(() => {
    const check = () => {
      refreshHolidays(Date.now(), (year) => holidayPlatform.fetchYear(year)).catch((error: unknown) => console.warn("Failed to update holiday data", error));
    };
    check();
    const timer = setInterval(check, HOLIDAY_CHECK_MS);
    return () => clearInterval(timer);
  }, []);

  // The pet menu shows the saved do-not-disturb state; switching it there is saved here.
  useEffect(() => {
    if (loadQuietPreferences().doNotDisturb) void petWindow.setDoNotDisturb(true).catch((error) => console.warn("Failed to restore do-not-disturb", error));
    return petWindow.onDoNotDisturbChanged((enabled) => {
      try { saveQuietPreferences({ ...loadQuietPreferences(), doNotDisturb: enabled }); } catch (error) { console.warn("Failed to save do-not-disturb", error); }
    });
  }, []);

  // The menu's focus item follows the round, and starts or stops it.
  useEffect(() => {
    if (!runtime) return;
    const sync = () => { void petWindow.syncFocusMenu(runtime.focus.get().phase).catch((error: unknown) => console.warn("Could not update the focus menu item", error)); };
    sync();
    const stops = [
      runtime.focus.subscribe(sync),
      petWindow.onFocusMenu((start) => runtime.bus.emit(start ? "pet.focus_toggled" : "pet.focus_stopped", {})),
    ];
    return () => stops.forEach((stop) => stop());
  }, [runtime]);

  // Shown again from the menu or the Dock icon: it may have been left on a screen that is gone.
  useEffect(() => petWindow.onRevealed(() => {
    petWindow.constrainToMonitor().then(refreshInsets).catch((error: unknown) => console.warn("Could not keep the pet on screen", error));
  }), [refreshInsets]);

  // "今日回顾" in the pet menu: a new chat that asks for it, answered in the chat window.
  useEffect(() => petWindow.onReviewRequested(() => {
    try {
      const loaded = loadThreads(packId);
      // Unreadable history is not overwritten: the chat window opens and says so.
      if (!loaded.valid) { void petWindow.openChat().catch((error: unknown) => console.error("Failed to open chat", error)); return; }
      const id = crypto.randomUUID();
      saveThreads(packId, recordThread(loaded.threads, id, [{ role: "user", content: REVIEW_REQUEST }], Date.now()));
      void petWindow.openChat(id, true).catch((error: unknown) => console.error("Failed to open chat for the review", error));
    } catch (error) {
      console.error("Could not start today's review", error);
    }
  }), [packId]);

  // "摸摸头" in the pet menu pats the pet like a long press does.
  useEffect(() => {
    if (!runtime) return;
    return petWindow.onPatRequested(() => runtime.bus.emit("pet.petted", {}));
  }, [runtime]);

  // "查收验证码" in the pet menu: the native side waits for the mail, the engine shows and says how it went.
  useEffect(() => {
    if (!runtime) return;
    return mailCodePlatform.onUpdate((update) => {
      runtime.bus.emit("pet.mail_code", update);
      if (update.kind === "unset") void petWindow.openSettings("tools").catch((error: unknown) => console.error("Failed to open the mailbox settings", error));
    });
  }, [runtime]);

  // The global quick chat shortcut. Settings changes it directly; this restores it at launch.
  useEffect(() => {
    if (!runtime) return;
    const shortcut = loadQuickChatShortcut();
    petWindow.setQuickChatShortcut(shortcut).catch((error: unknown) => {
      console.warn("Could not register the quick chat shortcut", error);
      if (shortcut) runtime.say(`${quickChatShortcutLabel(shortcut)} 被别的应用占用了，可以在设置里换一个`);
    });
  }, [runtime]);

  useEffect(() => {
    if (!runtime) return;
    translationPlatform.setSelectionFloat(loadSelectionFloat()).catch((error: unknown) => console.warn("Could not enable selection translation", error));
    const shortcut = loadTranslationShortcut();
    translationPlatform.setShortcut(shortcut).catch((error: unknown) => {
      console.warn("Could not register translation shortcut", error);
      if (shortcut) runtime.say(`翻译快捷键 ${quickChatShortcutLabel(shortcut)} 不可用，可以在设置里换一个`);
    });
  }, [runtime]);

  useEffect(() => subscribeDisplayPreferences(() => setDisplayPreferences(loadDisplayPreferences())), []);

  useEffect(() => {
    if (!runtime) return;
    // The action library's "播放": a sleeping pet wakes up first and plays it once awake.
    return petWindow.onActionRequested((id) => {
      const action = runtime.manifest.animations.find((item) => item.id === id);
      if (action && action.category !== "system" && (!action.loop || action.duration !== undefined) && runtime.registry.has(id)) runtime.bus.emit("pet.action_requested", { id });
    });
  }, [runtime]);

  useEffect(() => {
    if (!runtime) return;
    return petWindow.onAppearanceChanged((request) => {
      if (!request || typeof request.id !== "string" || typeof request.requestId !== "string") return;
      void runtime.refreshAppearance(request.id)
        .then(() => petWindow.reportAppearanceResult({ requestId: request.requestId }))
        .catch((error: unknown) => {
          console.error("Failed to update action appearance", error);
          void petWindow.reportAppearanceResult({ requestId: request.requestId, error: String(error) }).catch((reason) => console.warn("Failed to report appearance result", reason));
        });
    });
  }, [runtime]);

  // The native side knows where the cursor is even while the mouse passes through.
  useEffect(() => petWindow.onHoverChanged(setHovered), []);

  useEffect(() => { if (runtime && hovered) runtime.bus.emit("pet.hovered", {}); }, [runtime, hovered]);

  useEffect(() => {
    if (!runtime) return;
    return petWindow.onChatActionRequested((id, report) => runtime.bus.emit("pet.chat_action_requested", { id, report }));
  }, [runtime]);

  // The chat window says where its conversation stands; the pet listens, thinks and talks along.
  useEffect(() => {
    if (!runtime) return;
    return petWindow.onChatPhase((reported) => {
      const phase = CHAT_PHASES.find((known) => known === reported);
      if (phase) runtime.bus.emit("pet.chat_phase", { phase });
    });
  }, [runtime]);

  // A reminder or a note written down, or a reminder ticked off, in any window: the pet reacts.
  useEffect(() => {
    if (!runtime) return;
    let agenda = loadAgenda();
    let notes = new Set(loadNotes().map((note) => note.id));
    const stops = [
      subscribeAgenda(() => {
        const next = loadAgenda();
        const change = agendaChange(agenda, next);
        agenda = next;
        if (change) runtime.bus.emit(change === "added" ? "pet.noted" : "pet.item_done", {});
      }),
      subscribeNotes(() => {
        const next = loadNotes().map((note) => note.id);
        const added = hasNewId(notes, next);
        notes = new Set(next);
        if (added) runtime.bus.emit("pet.noted", {});
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [runtime]);

  useEffect(() => {
    if (!runtime) return;
    const { width, height } = stageSize(petBox.width, petBox.height);
    petWindow.setSize(width, height)
      .then(() => petWindow.constrainToMonitor())
      .then(refreshInsets)
      .catch((error) => console.error("Failed to resize the window", error));
  }, [runtime, petBox.width, petBox.height, refreshInsets]);

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    // When the pet hides behind a screen edge, the window goes flush against it.
    const stop = runtime.bus.on("pet.dock_changed", ({ side }) => {
      setDockSide(side);
      if (!side) return;
      petWindow.snapToEdge(side)
        .then(() => { refreshInsets(); return petWindow.savePosition(); })
        .catch((error) => console.error("Failed to snap the window to the edge", error));
    });
    // Left against a screen edge last time: hide behind it again. Only now that the listener
    // above is in place; sent any earlier, the pet would hide while this window still thought it was out.
    void (restoredPosition.current ?? Promise.resolve(false))
      .then((moved) => (moved ? petWindow.dockSide() : null))
      .then((side) => { if (side && !cancelled) runtime.bus.emit("pet.drag_ended", { dockSide: side }); })
      .catch((error: unknown) => console.warn("Could not restore the pet at the screen edge", error));
    return () => { cancelled = true; stop(); };
  }, [runtime, refreshInsets]);

  // A display unplugged, rearranged or rescaled: keep the pet on a screen, flush against its edge if it hid there.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settle = () => {
      timer = null;
      if (placement.current.dragging) return;
      const side = placement.current.dockSide;
      (side ? petWindow.snapToEdge(side) : petWindow.constrainToMonitor())
        .then(refreshInsets)
        .catch((error: unknown) => console.warn("Could not keep the pet on screen", error));
    };
    const stop = petWindow.onDisplayChanged(() => {
      if (placement.current.dragging) return;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(settle, DISPLAY_SETTLE_MS);
    });
    return () => { stop(); if (timer !== null) clearTimeout(timer); };
  }, [refreshInsets]);

  // Only the drawn pet and the visible controls take mouse input.
  useEffect(() => {
    if (!runtime || !petWindow.isNative) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** The mask last sent; an unchanged one is not sent again. */
    let lastSent = "";
    const send = () => {
      timer = null;
      const columns = Math.ceil(window.innerWidth / HIT_CELL_PX);
      const rows = Math.ceil(window.innerHeight / HIT_CELL_PX);
      const controls: MaskRect[] = [];
      if (controlsVisible && controlsRef.current) {
        const buttons = controlsRef.current.querySelectorAll<HTMLButtonElement>(".controls__action:not(:disabled)");
        for (const button of buttons) {
          const bounds = button.getBoundingClientRect();
          const rail = button.closest(".controls__rail")?.getBoundingClientRect();
          if (!rail) continue;
          const left = Math.max(bounds.left, rail.left);
          const top = Math.max(bounds.top, rail.top);
          const right = Math.min(bounds.right, rail.right);
          const bottom = Math.min(bounds.bottom, rail.bottom);
          if (right > left && bottom > top) controls.push({ left, top, right, bottom });
        }
      }
      const standing = alertRef.current?.getBoundingClientRect();
      const badge = badgeRef.current?.getBoundingClientRect();
      const bar = quickChat.open ? quickBarRef.current?.getBoundingClientRect() : undefined;
      const answer = quickReplyShown ? quickReplyRef.current?.getBoundingClientRect() : undefined;
      const cells = composeHitMask({
        cell: HIT_CELL_PX,
        columns,
        rows,
        drawn: runtime.opaqueMask(HIT_CELL_PX),
        offset: { columns: STAGE_MARGIN.side / HIT_CELL_PX, rows: STAGE_MARGIN.top / HIT_CELL_PX },
        grow: HIT_GROW_CELLS,
        rects: [...controls, standing, badge, bar, answer].filter((rect): rect is MaskRect => rect !== undefined),
      });
      const key = `${columns}:${cells.map(Number).join("")}`;
      if (key === lastSent) return;
      lastSent = key;
      petWindow
        .setHitMask(HIT_CELL_PX, columns, cells)
        .catch((error) => { lastSent = ""; console.error("Failed to update the clickable area", error); });
    };
    const schedule = () => {
      if (timer === null) timer = setTimeout(send, HIT_MASK_DELAY_MS);
    };
    schedule();
    const unsubscribe = [
      runtime.bus.on("pet.action.started", schedule),
      runtime.bus.on("pet.appearance.changed", schedule),
      runtime.bus.on("pet.dock_changed", schedule),
    ];
    const observer = new ResizeObserver(schedule);
    for (const element of [controlsRef.current, quickBarRef.current, quickReplyRef.current]) if (element) observer.observe(element);
    const controlsElement = controlsRef.current;
    const controlsMutations = controlsElement ? new MutationObserver(schedule) : null;
    controlsMutations?.observe(controlsElement!, { childList: true, subtree: true, attributes: true });
    controlsElement?.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      if (timer !== null) clearTimeout(timer);
      for (const stop of unsubscribe) stop();
      observer.disconnect();
      controlsMutations?.disconnect();
      controlsElement?.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [runtime, controlsVisible, insets, alert, speechLayout, quickChat.open, quickReplyShown, dockSide]);

  // Without a pet there is no mask: let the error message take the mouse instead.
  useEffect(() => { if (loadError) maskToElement(loadErrorRef.current); }, [loadError]);

  // A plain browser has no native hover tracking, so fall back to DOM events.
  const browserHover = petWindow.isNative
    ? {}
    : { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) };

  /** Anywhere in the pet window a right click opens the pet menu, not the webview's own (which has "Reload"); text fields keep theirs. */
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("input, textarea")) return;
    event.preventDefault();
    petWindow.showMenu().catch((error) => console.error("Failed to open the pet menu", error));
  };

  // Overlays stay inside the part of the window that is on screen.
  const layout = {
    "--stage-side": `${STAGE_MARGIN.side}px`,
    "--stage-top": `${STAGE_MARGIN.top}px`,
    "--stage-bottom": `${STAGE_MARGIN.bottom}px`,
    "--visible-left": `${insets.left}px`,
    "--visible-right": `${insets.right}px`,
    "--visible-top": `${insets.top}px`,
    "--visible-bottom": `${insets.bottom}px`,
  } as CSSProperties;

  return (
    <main className={`app${dockSide ? ` app--docked-${dockSide}` : ""}`} style={layout} onContextMenu={onContextMenu} {...browserHover}>
      <div className="pet-frame" style={runtime ? { width: petBox.width, height: petBox.height } : undefined}>
        <PetStage runtime={runtime} hostRef={hostRef} />
      </div>
      {runtime && <PetSpeech runtime={runtime} alertRef={alertRef} badgeRef={badgeRef} onLayoutChange={onSpeechLayout} hideBadge={quickChat.open} reply={quickReplyShown ? <QuickReplyBubble ref={quickReplyRef} chat={quickChat} /> : undefined} />}
      {runtime && <PetControls ref={controlsRef} runtime={runtime} visible={controlsVisible} offscreenInsets={insets} />}
      {runtime && quickChat.open && <QuickChatBar ref={quickBarRef} chat={quickChat} />}
      {loadError && <p ref={loadErrorRef} className="load-error" role="alert">{loadError}</p>}
    </main>
  );
}
