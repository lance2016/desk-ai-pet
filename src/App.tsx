import { loadSelectionFloat } from "./preferences/SelectionFloat";
import { ai } from "./ai";
import { translationPlatform } from "./platform/translation";
import { loadTranslationShortcut } from "./preferences/TranslationShortcut";
import { loadPanelShortcut, SHORTCUT_PANELS } from "./preferences/PanelShortcuts";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent } from "react";
import "./App.css";
import { dueReminders, leftoverReminders, loadAgenda, markReminded, moveToToday, setAgendaItemDone, snoozeReminders, subscribeAgenda, type AgendaItem } from "./agenda/AgendaStore";
import { agendaChange, hasNewId } from "./agenda/changes";
import { localTimeText } from "./agenda/chatTools";
import { refreshHolidays } from "./agenda/Workdays";
import { linksEnabled, subscribeLinks } from "./links/LinkStore";
import { dubbingEnabled, subscribeDubbingEnabled } from "./dubbing/DubbingStore";
import { loadNotes, subscribeNotes } from "./notes/NoteStore";
import type { ReminderSource } from "./behavior/BehaviorEngine";
import { Companion, PAT_REPLY } from "./companion";
import { markAnswered } from "./companion/history";
import { collectFacts, LOOK_BACK_DAYS } from "./companion/GreetingContent";
import { changeReminders, readWorkLog, recordWork, tidyWorkLog } from "./worklog/store";
import { addDays, EMPTY_WORK_LOG } from "./worklog/WorkLog";
import { loadCompanionPreferences } from "./preferences/CompanionPreferences";
import { loadThreads, recordThread, saveThreads } from "./chat/ChatThreads";
import { holidayPlatform } from "./platform/holidays";
import { requestPreferences } from "./preferences/ChatPreferences";
import { isOnboarded, markOnboarded } from "./preferences/UserProfile";
import { PetControls } from "./components/PetControls";
import { QuickChatBar, QuickReplyBubble, useQuickChat } from "./components/QuickChat";
import { usePetDrop } from "./components/usePetDrop";
import { ChatLauncher } from "./components/ChatLauncher";
import { createHoverMark } from "./components/hoverMark";
import { FADE_OUT_MS, useLingering } from "./components/presence";
import { FocusAura, FOCUS_EXIT_MS } from "./components/FocusAura";
import { PetSpeech } from "./components/PetSpeech";
import { PetStage } from "./components/PetStage";
import { PetRuntime } from "./core/PetRuntime";
import { loadCharacterPack } from "./assets/PackCatalog";
import { loadUserActions } from "./actions/UserActions";
import { applyLaunchAtLoginDefault } from "./preferences/LaunchAtLogin";
import { systemPlatform } from "./platform/system";
import { composeHitMask, headInsets, HIT_CELL_PX, maskToElement, type MaskRect } from "./platform/hitMask";
import { saveActiveCharacter } from "./preferences/CharacterPreferences";
import { DEFAULT_PACK_ID } from "./assets/PackCatalog";
import { petWindow } from "./platform/petWindow";
import { dubbingPlatform } from "./platform/dubbing";
import { capturePlatform } from "./platform/capture";
import { agentCaptureEnabled, subscribeAgentCapture } from "./preferences/CapturePreferences";
import { mailCodePlatform } from "./platform/mailCode";
import { MAIL_CODE_ACTIVITY, mailCodeActivity } from "./activity/mailCodeActivity";
import { followClaude, revealClaude } from "./agents/followClaude";
import { speechSide, STAGE_MARGIN, stageSize, type OffscreenInsets } from "./platform/stageGeometry";
import { PixiRenderer } from "./renderer/PixiRenderer";
import { loadDisplayPreferences, loadOnTop, saveOnTop, subscribeDisplayPreferences, type ChatLauncher as ChatLauncherStyle } from "./preferences/DisplayPreferences";
import { isQuietAt, loadQuietPreferences, saveQuietPreferences } from "./preferences/QuietPreferences";
import { loadQuickChatShortcut, quickChatShortcutLabel } from "./preferences/QuickChatPreferences";
import { recordActionTrigger } from "./preferences/ActionTriggerStats";
import { createLocalPetStorage } from "./storage/PetStorage";
import { loadFocus, saveFocus } from "./storage/FocusStorage";
import { loadFocusPreferences } from "./preferences/FocusPreferences";
import type { FocusSnapshot } from "./behavior/FocusTimer";
import { updaterPlatform } from "./platform/updater";
import { startUpdateChecks } from "./update/UpdateNotice";
import { announceUpdate, skipWhatsNew } from "./update/WhatsNew";
import { CHAT_PHASES } from "./types";

/** The pose the chat button is placed against. */
const RESTING_ACTION = "idle";
const DEFAULT_SCALE = 1;
/** Set once the pet has told a new user how to play with it. */
const INTRO_KEY = "ai-pet:intro-tips:v1";
/** How to start a chat depends on where the chat button is: with none, a click on the pet opens it. */
const introLines = (launcher: ChatLauncherStyle) => [launcher === "none" ? "点我一下就能聊天" : "点我头旁边的小气泡就能聊天", "按住我是摸摸头，右键还有更多"];
/** What "今日回顾" in the pet menu asks in a new chat; the model looks up today's record to answer it. */
const REVIEW_REQUEST = "帮我回顾一下今天，写成能直接贴进日报的几条。";

/** Set when a character could not be loaded and the default one stands in; the pet says so once it is up. */
let fallbackNotice: string | null = null;
/** Cells the clickable area extends past the drawing, to cover its motion. */
const HIT_GROW_CELLS = 2;
/** Wait for layout and the renderer to settle before measuring the mask. */
const HIT_MASK_DELAY_MS = 30;
/**
 * How far the window may hang off the bottom of the screen before the bar has to move up onto the pet's legs
 * (`--overhang` in App.css). Past it the bar hides until the mouse is on the pet.
 */
const FREE_OVERHANG_PX = 46;
/** Where an element takes clicks: nowhere while it is gone or fading out (`pointer-events: none`). */
const box = (element: Element | null | undefined): MaskRect | undefined =>
  element && getComputedStyle(element).pointerEvents !== "none" ? element.getBoundingClientRect() : undefined;
/** Moves come in bursts while macOS rearranges windows; act once they stop. */
const DISPLAY_SETTLE_MS = 500;
/** How often to read how long the keyboard and mouse have been idle: for the pet's naps, and to see whether the pet has something to say. */
const ACTIVITY_CHECK_MS = 10_000;
/** How often the pet's mood is worked out again from the day so far. */
const MOOD_CHECK_MS = 5 * 60_000;
/** How often to see whether a missing year of holiday data can be downloaded; it is looked up once a day. */
const HOLIDAY_CHECK_MS = 60 * 60_000;
/** How often to fold old work log days into counts; the pet may run for weeks without a restart. */
const WORKLOG_TIDY_MS = 6 * 60 * 60_000;

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

/** The pet's own buttons ("完成", "挪到今天") are the user's doing; marking reminders shown records nothing. */
function changeAgenda(change: (items: AgendaItem[]) => AgendaItem[], failure: string): void {
  try {
    agendaCache = changeReminders(change, "user");
  } catch (error) {
    console.error(failure, error);
    // Storage may be full. Keep the change for this run, or the same reminder rings again every tick and cannot be put away.
    try { agendaCache = change(cachedAgenda()); } catch (inner) { console.error("Could not apply the reminder change in memory either", inner); }
  }
}

const REMINDERS: ReminderSource = {
  due: (now) => dueReminders(cachedAgenda(), now),
  markReminded: (ids, now) => changeAgenda((items) => markReminded(items, ids, now), "Failed to save that a reminder was shown"),
  complete: (ids, now) => changeAgenda((items) => ids.reduce((list, id) => setAgendaItemDone(list, id, true, now), items), "Failed to tick off reminders"),
  snooze: (ids, until, now) => changeAgenda((items) => snoozeReminders(items, ids, now, until), "Failed to snooze reminders"),
  leftovers: (now) => leftoverReminders(cachedAgenda(), now).map(({ id, text, remindAt }) => ({ id, text, remindAt })),
  moveToToday: (ids, now) => changeAgenda((items) => moveToToday(items, ids, now), "Failed to move reminders to today"),
};
const isQuiet = (now: number) => isQuietAt(loadQuietPreferences(), now);
/** Reminders the user timed come even in quiet hours; only "勿扰" holds them back. */
const holdsReminders = () => loadQuietPreferences().doNotDisturb;
const CAPTURE_ACTIVITY = { id: "capture", label: "截图", icon: "image" } as const;
const FOCUS_STORE ={ load: () => loadFocus(), save: (snapshot: FocusSnapshot) => saveFocus(snapshot) };
const focusMinutes = () => loadFocusPreferences().minutes;

interface AppProps {
  /** Character to show. The window remounts this component when it changes. */
  packId: string;
}

export default function App({ packId }: AppProps) {
  const showLinks = useSyncExternalStore(subscribeLinks, linksEnabled);
  useEffect(() => {
    void petWindow.setLinksEnabled(showLinks).catch((error: unknown) => console.error("Failed to update the links menu", error));
  }, [showLinks]);
  const showDubbing = useSyncExternalStore(subscribeDubbingEnabled, dubbingEnabled);
  useEffect(() => {
    void dubbingPlatform.setEnabled(showDubbing).catch((error: unknown) => console.error("Failed to update the dubbing menu", error));
  }, [showDubbing]);
  const agentCapture = useSyncExternalStore(subscribeAgentCapture, agentCaptureEnabled);
  useEffect(() => {
    void capturePlatform.setEnabled(agentCapture).catch((error: unknown) => console.error("Failed to update screenshots for coding agents", error));
  }, [agentCapture]);
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
  const launcherRef = useRef<HTMLButtonElement>(null);
  /** Room between the head of the pet's resting pose and the edges of its area, so the chat button sits by the head itself. */
  const [head, setHead] = useState({ top: 0, left: 0, right: 0 });
  /** Text of the standing reminder bubble, which must take clicks while it is up. */
  const [alert, setAlert] = useState<string | null>(null);
  const [runtime, setRuntime] = useState<PetRuntime | null>(null);
  const subscribeFocusMode = useCallback((listener: () => void) => runtime?.focus.subscribe(listener) ?? (() => {}), [runtime]);
  const getFocusActive = useCallback(() => runtime?.focus.get().phase === "focusing", [runtime]);
  const focusActive = useSyncExternalStore(subscribeFocusMode, getFocusActive, getFocusActive);
  const focusMode = useLingering(focusActive, FOCUS_EXIT_MS);
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
  const quickChat = useQuickChat(runtime, packId, { style: displayPreferences.chatLauncher, copyHint: displayPreferences.copyHint });
  // Nothing is handed to the pet while it keeps a focus round or is still answering.
  usePetDrop(runtime !== null && !focusMode && !quickChat.pending, quickChat.receive, focusMode ? () => runtime?.bus.emit("pet.drop_refused", {}) : undefined);
  const quickReplyShown = quickChat.bubble;
  const launcherStyle = displayPreferences.chatLauncher;
  /** Focus leaves only the pet, its pool of light, the status row (the focus pill) and, on hover, notes and reminders on stage. */
  const launcherShown = launcherStyle !== "none" && !dragging && !dockSide && !quickChat.open && !focusMode;
  /** The bar under the pet stays hidden while dragged, docked, or giving way to chat. While focused it keeps notes and reminders, shown only on hover. */
  const barShown = !dragging && !dockSide && !quickChat.open;
  // Both fade out before they go, rather than vanish: they stay mounted that long, taking no clicks.
  const launcherMounted = useLingering(launcherShown, FADE_OUT_MS);
  const barMounted = useLingering(barShown, FADE_OUT_MS);
  const barAwake = useLingering(hovered, displayPreferences.controlsLingerMs);
  /** The bar has been pushed up onto the pet: it shows only while the mouse is there. */
  const barTucked = insets.bottom > FREE_OVERHANG_PX;
  // Under the menu bar there is no room above the head: the bubble speaks from beside it.
  const speakingFrom = speechSide(insets, head, Boolean(dockSide));
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
      .then((pack) => PetRuntime.create({ renderer, storage, pack, reminders: REMINDERS, isQuiet, holdsReminders, focusStore: FOCUS_STORE, focusMinutes, userActions: () => loadUserActions(packId), onActionStarted: (actionId) => recordActionTrigger(packId, actionId) }))
      .then((instance) => {
        if (cancelled) {
          instance.destroy();
          return;
        }
        created = instance;
        setRuntime(instance);
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

  // Said once the speech bubble listens: the bus does not replay, and children subscribe in their effects, which run before this one.
  useEffect(() => {
    if (!runtime || !fallbackNotice) return;
    runtime.say(fallbackNotice);
    fallbackNotice = null;
  }, [runtime]);

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
    for (const line of introLines(loadDisplayPreferences().chatLauncher)) runtime.say(line);
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

  // What the pet says by itself: greetings and care, one line at a time (`src/companion/`).
  useEffect(() => {
    if (!runtime) return;
    /** A line allowed in quiet hours still waits while "勿扰" is on. */
    const passesQuiet = (allowQuiet: boolean) => allowQuiet && !loadQuietPreferences().doNotDisturb;
    const companion = new Companion({
      settings: () => loadCompanionPreferences(),
      quietHours: () => loadQuietPreferences().quietHours,
      reminders: () => cachedAgenda(),
      storage: window.localStorage,
      maySpeak: (allowQuiet) => runtime.maySpeakUp(passesQuiet(allowQuiet)),
      day: async (now) => {
        const log = await readWorkLog(addDays(now, -LOOK_BACK_DAYS), now).catch((error: unknown) => {
          console.warn("Speaking up without the work log", error);
          return EMPTY_WORK_LOG;
        });
        return collectFacts(loadAgenda(), log, now);
      },
      write: (intent, facts, now) => ai.greet(intent, facts, requestPreferences(packId, runtime.manifest.persona), localTimeText(now)),
      say: ({ text, allowQuiet, offerMove }) => runtime.greet(text, passesQuiet(allowQuiet), offerMove),
      show: (text) => runtime.greetOnRequest(text),
    });
    const stopTest = petWindow.onCompanionTest(({ requestId, occasion }) => {
      void (async () => {
        if (runtime.focus.get().phase === "focusing") {
          await petWindow.reportCompanionTest({ requestId, error: "专注期间不能试，请先结束专注。" });
          return;
        }
        const shown = await companion.test(occasion, Date.now());
        await petWindow.reportCompanionTest(shown ? { requestId } : { requestId, error: "它正在准备另一句话，请稍后再试。" });
      })().catch((error: unknown) => {
        console.error("Failed to try a companion line", error);
        void petWindow.reportCompanionTest({ requestId, error: "这句话没能显示，请再试一次。" });
      });
    });
    let active = true;
    let pending = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      try {
        const idle = await systemPlatform.idleSeconds().catch((error: unknown) => {
          console.warn("Could not check system activity", error);
          return null;
        });
        if (!active) return;
        const now = Date.now();
        if (idle !== null) runtime.bus.emit("pet.user_active", { at: now - idle * 1000 });
        // Not awaited: writing a line takes a while, and the next reading should not wait for it.
        companion.check(now, idle).catch((error: unknown) => console.error("Failed to speak up", error));
      } finally { pending = false; }
    };
    void check();
    const timer = setInterval(() => void check(), ACTIVITY_CHECK_MS);
    // A pat right after the pet spoke is an answer to it, and gets a word back.
    const stopPats = runtime.bus.on("pet.petted", () => { if (companion.heard(Date.now())) runtime.say(PAT_REPLY); });
    // How the pet feels follows the user's day; the engine shows it in how the pet fidgets.
    const tellMood = () => {
      companion.mood(Date.now())
        .then((mood) => { if (active) runtime.bus.emit("pet.mood", { mood }); })
        .catch((error: unknown) => console.warn("Could not work out the pet's mood", error));
    };
    tellMood();
    const moodTimer = setInterval(tellMood, MOOD_CHECK_MS);
    return () => { active = false; clearInterval(timer); clearInterval(moodTimer); stopPats(); stopTest(); };
  }, [runtime, packId]);

  // Opening the bar onto what the pet said is an answer to it too.
  const answeringLine = quickChat.answering;
  useEffect(() => {
    if (answeringLine === null) return;
    try { markAnswered(Date.now()); } catch (error) { console.warn("Could not note that the pet was answered", error); }
  }, [answeringLine]);

  // The work log: old focus counts brought in once, and old days folded into counts now and then.
  useEffect(() => {
    const tidy = () => { tidyWorkLog(Date.now()).catch((error: unknown) => console.warn("Could not tidy the work log", error)); };
    tidy();
    const timer = setInterval(tidy, WORKLOG_TIDY_MS);
    return () => clearInterval(timer);
  }, []);

  // A focus round that ends in a rest was finished; one that ends in nothing was stopped or interrupted.
  useEffect(() => {
    if (!runtime) return;
    let phase = runtime.focus.get().phase;
    return runtime.focus.subscribe(() => {
      const next = runtime.focus.get().phase;
      if (phase === "focusing" && next !== "focusing") void recordWork([{ kind: next === "resting" ? "focus_completed" : "focus_stopped", text: "", before: null, itemId: null }], "user");
      phase = next;
    });
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
      // Stopping a round asks first, as the countdown and the button do (`pet.focus_toggled`); ending a rest does not.
      petWindow.onFocusMenu((start) => runtime.bus.emit(start || runtime.focus.get().phase === "focusing" ? "pet.focus_toggled" : "pet.focus_stopped", {})),
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

  // "3 秒后截图" in the pet menu: the native side waits, copies the pet window, then says how it went.
  // Nothing shows while it waits, so the picture has no chip or bubble about itself.
  useEffect(() => {
    if (!runtime) return;
    return capturePlatform.onCaptured((copied) => runtime.bus.emit("pet.activity", copied
      ? { ...CAPTURE_ACTIVITY, state: "done", text: "截好了，已复制到剪贴板" }
      : { ...CAPTURE_ACTIVITY, state: "failed", text: "这次没截到，再试一次吧" }));
  }, [runtime]);

  // "查收验证码" in the pet menu: the native side waits for the mail and reports it as an activity; a click on its chip stops the wait.
  useEffect(() => {
    if (!runtime) return;
    const stops = [
      mailCodePlatform.onUpdate((update) => {
        const { activity, say } = mailCodeActivity(update);
        runtime.bus.emit("pet.activity", activity);
        if (say) runtime.say(say);
        if (update.kind === "unset") void petWindow.openSettings("mail").catch((error: unknown) => console.error("Failed to open the mailbox settings", error));
      }),
      runtime.bus.on("pet.activity_chip_clicked", ({ id }) => {
        if (id === MAIL_CODE_ACTIVITY) void mailCodePlatform.cancel().catch((error: unknown) => console.error("Failed to stop waiting for a mail code", error));
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }, [runtime]);

  // Claude Code sessions, from its hooks: the coding card shows them, and the pet reacts when one waits for the user or is done.
  // "回到终端" on the pet's line about a session brings its terminal forward.
  useEffect(() => {
    if (!runtime) return;
    const stops = [
      followClaude((update) => runtime.bus.emit("pet.activity", update)),
      runtime.bus.on("pet.activity_opened", ({ id }) => revealClaude(id)),
    ];
    return () => stops.forEach((stop) => stop());
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

  // The shortcuts that open the reminder and note panels, if the user recorded any.
  useEffect(() => {
    if (!runtime) return;
    for (const panel of SHORTCUT_PANELS) {
      const shortcut = loadPanelShortcut(panel);
      if (!shortcut) continue;
      petWindow.setPanelShortcut(panel, shortcut).catch((error: unknown) => {
        console.warn(`Could not register the ${panel} shortcut`, error);
        runtime.say(`${quickChatShortcutLabel(shortcut)} 被别的应用占用了，可以在设置里换一个`);
      });
    }
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

  // The styles match `data-hover`, not `:hover`, which WebKit freezes while the pet is not the key window.
  // The native cursor always gets through; page events only while the window is key, or in a plain browser.
  useEffect(() => {
    const hover = createHoverMark((x, y) => document.elementFromPoint(x, y));
    const onMove = (event: PointerEvent) => hover.at(event.clientX, event.clientY);
    const root = document.documentElement;
    window.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", hover.clear);
    const stopPointer = petWindow.onPointerMoved(hover.at);
    const stopHover = petWindow.onHoverChanged((on) => { if (!on) hover.clear(); });
    return () => {
      window.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", hover.clear);
      stopPointer();
      stopHover();
      hover.clear();
    };
  }, []);

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
  // Where the head of the resting pose is, for the chat button. Measured on that pose only, so the
  // button does not follow every action around; again when the pictures or the size change.
  useEffect(() => {
    if (!runtime) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      timer = null;
      const drawn = runtime.currentActionId === RESTING_ACTION ? runtime.opaqueMask(HIT_CELL_PX) : null;
      const found = drawn ? headInsets(drawn, HIT_CELL_PX) : null;
      if (found) setHead((current) => (current.top === found.top && current.left === found.left && current.right === found.right ? current : found));
    };
    const schedule = () => { if (timer === null) timer = setTimeout(measure, HIT_MASK_DELAY_MS); };
    schedule();
    const stops = [runtime.bus.on("pet.action.started", schedule), runtime.bus.on("pet.appearance.changed", schedule)];
    return () => { stops.forEach((stop) => stop()); if (timer !== null) clearTimeout(timer); };
  }, [runtime, scale]);

  useEffect(() => {
    if (!runtime || !petWindow.isNative) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /** The mask last sent; an unchanged one is not sent again. */
    let lastSent = "";
    const send = () => {
      timer = null;
      const columns = Math.ceil(window.innerWidth / HIT_CELL_PX);
      const rows = Math.ceil(window.innerHeight / HIT_CELL_PX);
      // The bar takes clicks whenever it shows, faint or not; so does its menu while it is open.
      const controls: MaskRect[] = barShown && controlsRef.current
        ? [controlsRef.current, controlsRef.current.querySelector(".pet-bar__menu")].flatMap((element) => box(element) ?? [])
        : [];
      const standing = box(alertRef.current);
      const badge = box(badgeRef.current);
      const bar = quickChat.open ? box(quickBarRef.current) : undefined;
      const answer = quickReplyShown ? box(quickReplyRef.current) : undefined;
      const launcher = launcherShown ? box(launcherRef.current) : undefined;
      const cells = composeHitMask({
        cell: HIT_CELL_PX,
        columns,
        rows,
        drawn: runtime.opaqueMask(HIT_CELL_PX),
        offset: { columns: STAGE_MARGIN.side / HIT_CELL_PX, rows: STAGE_MARGIN.top / HIT_CELL_PX },
        grow: HIT_GROW_CELLS,
        rects: [...controls, standing, badge, bar, answer, launcher].filter((rect): rect is MaskRect => rect !== undefined),
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
    // The status row widens when a chip starts showing minutes.
    for (const element of [controlsRef.current, quickBarRef.current, quickReplyRef.current, launcherRef.current, badgeRef.current]) if (element) observer.observe(element);
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
  }, [runtime, barShown, barAwake, insets, alert, speechLayout, quickChat.open, quickReplyShown, dockSide, launcherShown, launcherStyle, speakingFrom]);

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
    "--head-top": `${head.top}px`,
    "--head-left": `${head.left}px`,
    "--head-right": `${head.right}px`,
    "--visible-left": `${insets.left}px`,
    "--visible-right": `${insets.right}px`,
    "--visible-top": `${insets.top}px`,
    "--visible-bottom": `${insets.bottom}px`,
  } as CSSProperties;

  return (
    <main className={`app${dockSide ? ` app--docked-${dockSide}` : ""}${speakingFrom ? ` app--speech-${speakingFrom}` : ""}${focusActive ? " app--focus" : ""}`} style={layout} onContextMenu={onContextMenu} {...browserHover}>
      <div className="pet-frame" style={runtime ? { width: petBox.width, height: petBox.height } : undefined}>
        {runtime && !dragging && !dockSide && <FocusAura runtime={runtime} visible={focusMode} />}
        <PetStage runtime={runtime} hostRef={hostRef} />
      </div>
      {runtime && <PetSpeech runtime={runtime} alertRef={alertRef} badgeRef={badgeRef} onLayoutChange={onSpeechLayout} hideBadge={quickChat.open} tight={Boolean(dockSide) || insets.bottom > 0} overPet={!dockSide && !speakingFrom} reply={quickReplyShown ? <QuickReplyBubble ref={quickReplyRef} chat={quickChat} /> : undefined} launcher={launcherMounted && launcherStyle !== "none" ? (aside) => <ChatLauncher ref={launcherRef} side={launcherStyle} aside={aside} leaving={!launcherShown} hinting={quickChat.copied ? "copied" : quickChat.spoke ? "spoke" : null} onClick={quickChat.launch} /> : undefined} />}
      {runtime && barMounted && <PetControls ref={controlsRef} runtime={runtime} awake={barAwake} tucked={barTucked || focusMode} focusing={focusMode} leaving={!barShown} />}
      {runtime && quickChat.open && <QuickChatBar ref={quickBarRef} chat={quickChat} />}
      {loadError && <p ref={loadErrorRef} className="load-error" role="alert">{loadError}</p>}
    </main>
  );
}
