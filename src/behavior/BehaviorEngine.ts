import type { ActionController } from "../actions/ActionController";
import { IDLE_ACTION, type ActionRegistry } from "../actions/ActionRegistry";
import type { EventBus } from "../core/EventBus";
import type { PetState } from "../core/PetState";
import { ActivityBoard } from "../activity/ActivityBoard";
import type { ActivityState, ActivityUpdate, AlertChoice, ChatPhase, DockSide, Mood, PetEvents, PetStats, StatusChip } from "../types";
import { FOCUS_CONFIG, focusBadge, focusProgress, type FocusTimer } from "./FocusTimer";

/** Played while the user carries the pet around. */
const DRAG_ACTION = "drag";
/** Played while the pet hides behind a screen edge. */
const PEEK_ACTION = "peek";
/** Held while the pet keeps the user company during a focus round. */
export const FOCUS_ACTION = "focus";
/** Played when the user pats the pet (long press or the menu). */
const PET_ACTION = "pet_reaction";
/** Played instead once the pats keep coming. */
const SHY_ACTION = "shy";
/** Played when a focus round is done. */
const FOCUS_DONE_ACTION = "happy";
/** Played to catch the user's eye for a reminder. */
const REMIND_ACTION = "remind";
/** Played with a morning or evening greeting. */
const GREET_ACTION = "wave";
/** Played when a reminder or a note is written down. */
const NOTE_ACTION = "write";
/** Played when a reminder is ticked off. */
const DONE_ACTION = "happy";
/** Played when a reply, a voice transcription or an activity failed. */
const CONFUSED_ACTION = "confused";
/** Played when an activity is done, such as a verification code copied for the user. */
const ACTIVITY_DONE_ACTION = "happy";
/** Played once when an agent sets to work while none was at it; the ones that follow go unremarked. */
const AGENT_WORK_ACTION = "write";
const AGENT_ICON = "agent";
/** How the pet reacts when an activity gets to a state; nothing while it just runs or when it is called off. */
const ACTIVITY_ACTIONS: Partial<Record<ActivityState, string>> = { waiting: REMIND_ACTION, done: ACTIVITY_DONE_ACTION, failed: CONFUSED_ACTION };
/** Played shortly before the pet dozes off. */
const YAWN_ACTION = "yawn";
/** Played when the cursor comes onto the idle pet. */
const GLANCE_ACTION = "look_around";
/**
 * The pose held while a reply is on its way. Typing and the reply itself have no
 * pose: the pet stands free, so a reaction or an action the reply picked shows.
 */
const THINK_POSE = "think";
/** Poses nothing but this engine puts up, so one that is playing is its own to take down. */
const ENGINE_POSES: ReadonlySet<string> = new Set([FOCUS_ACTION]);

/** What the pet says around a focus round. Shown in the speech bubble. */
const FOCUS_LINES = {
  started: `好，我陪你专注 ${FOCUS_CONFIG.focusMs / 60_000} 分钟！`,
  askStop: (minutes: number) => `已经专注 ${minutes} 分钟了，现在停下，这轮就不算了。`,
  askRest: (minutes: number) => `还能休息 ${minutes} 分钟，要提前开始下一轮吗？`,
  stopped: "好，先停一下，随时再开始。",
  finished: "专注完成！辛苦啦，起来活动一下吧～",
  interrupted: "电脑睡着时这轮专注到点了，这轮先不算，随时再开始。",
  restOver: "休息好啦，要不要再来一轮？",
};

/** Putting an activity's line away; the other button takes the user to it. */
const ACTIVITY_DISMISS: AlertChoice = { label: "收起", event: "pet.alert_dismissed" };
/** The kinds of line the standing line can show, one at a time (`standing`). */
type Standing = "focusPrompt" | "reminders" | "activity" | "moveOffer" | "focusNotice";
/** The answers on the standing line when the user asks to stop a round, or clicks the rest countdown. */
const FOCUS_CHOICES = {
  stop: [
    { label: "继续专注", event: "pet.alert_dismissed" },
    { label: "停止专注", event: "pet.focus_stopped", destructive: true },
  ],
  rest: [
    { label: "继续休息", event: "pet.alert_dismissed" },
    { label: "开始专注", event: "pet.focus_toggled" },
  ],
} satisfies Record<string, AlertChoice[]>;

/** A line names this many reminders at most; more are counted, and a click opens the panel. */
const MAX_NAMED_REMINDERS = 2;
const REMINDER_LINES = {
  /** Headings over the reminders' own words, which the bubble shows larger. */
  onTime: "到点啦",
  late: "别忘了",
  named: (texts: string[]) => texts.join("、"),
  many: (texts: string[], count: number) => `${texts.join("、")} 等 ${count} 件`,
  badge: (count: number) => `提醒 ${count}`,
  doNotDisturb: "勿扰",
  snoozed: (minutes: number) => `好，${minutes} 分钟后再叫你`,
};

/** The answers on a line naming one or two reminders. A longer line opens the panel instead: it does not show them all. */
const reminderChoices = (count: number): AlertChoice[] => [
  { label: `${BEHAVIOR_CONFIG.snoozeMs / 60_000} 分钟后`, event: "pet.reminders_snoozed" },
  { label: count > 1 ? "都完成" : "完成", event: "pet.reminders_done" },
];

/** The line after the morning greeting when earlier reminders are still open. */
const MOVE_LINES = {
  heading: "之前没做完",
  named: (texts: string[]) => texts.length > MAX_NAMED_REMINDERS ? `${texts.slice(0, MAX_NAMED_REMINDERS).join("、")} 等 ${texts.length} 件` : texts.join("、"),
  moved: "挪到今天了，到点我再叫你",
};
const MOVE_CHOICES: AlertChoice[] = [
  { label: "不用了", event: "pet.alert_dismissed" },
  { label: "挪到今天", event: "pet.leftovers_moved" },
];

export const BEHAVIOR_CONFIG = {
  /** Actions in this category are played at random while the pet is idle. */
  idleCategory: "idle",
  /** Shortest and longest wait between two random idle actions. */
  idleActionIntervalMs: { min: 6_000, max: 14_000 },
  /** The wait between idle actions is this many times as long in each mood: livelier when bright, slower when tired. */
  idlePace: { bright: 0.6, calm: 1, tired: 1.6 },
  /** While tired, an idle action is a yawn this often. */
  tiredYawnChance: 0.3,
  /**
   * The pet falls asleep after this long without the user: not touching the
   * computer, where that is known (`pet.user_active`), else not touching the pet.
   */
  sleepAfterIdleMs: 5 * 60_000,
  effects: {
    feed: { satiety: 25, mood: 5, affinity: 1 },
    pet: { mood: 3, affinity: 2 },
    focusDone: { mood: 5, affinity: 2 },
  } satisfies Record<string, Partial<PetStats>>,
  /** A reminder announced this long after its time is worded as a late one. */
  reminderLateMs: 10 * 60_000,
  /** "稍后提醒" brings the reminders up again after this long. */
  snoozeMs: 10 * 60_000,
  /** A question about the focus round goes away unanswered after this long, as if "继续" was picked. */
  focusPromptMs: 15_000,
  /** After a greeting the pet goes back behind the edge it came from, once this has passed. */
  backToEdgeAfterGreetingMs: 10_000,
  /** After the reminder line is dismissed, the same, a moment later. */
  backToEdgeAfterAlertMs: 1_500,
  /**
   * A conversation counts as over this long after the last report of its phase, so a
   * window that went away mid-chat cannot leave the pet waiting in it. Typing
   * renews "listening" with every keystroke.
   */
  chatHoldMs: { listening: 8_000, thinking: 120_000, talking: 120_000 },
  /** The pet yawns this long before it falls asleep. */
  yawnBeforeSleepMs: 20_000,
  /** Pats this close together are one streak; from this pat of a streak on, the pet turns shy. */
  patStreakMs: 20_000,
  shyFromPat: 3,
  /** Shortest time between two cheers for ticked-off reminders. */
  cheerGapMs: 10_000,
  /** Shortest time between two glances at the cursor. */
  glanceGapMs: 30_000,
  /** A round this young stops without asking, from the countdown, the button or the menu: there is nothing yet to lose. */
  focusFreeStopMs: 60_000,
  /** Shortest time between two looks up at a click: each click shows it landed, a burst of them does not set the pet twitching. */
  clickGlanceGapMs: 3_000,
  /** The pet sits down to write when an agent sets to work, at most this often. */
  agentWorkGapMs: 10 * 60_000,
};

/** A reminder whose time has come. */
export interface DueReminder {
  id: string;
  text: string;
  remindAt: number | null;
}

/** Where reminders come from. The pet reads them and records how the user answered the line. */
export interface ReminderSource {
  due(now: number): DueReminder[];
  markReminded(ids: string[], now: number): void;
  complete(ids: string[], now: number): void;
  snooze(ids: string[], until: number, now: number): void;
  /** One-off reminders from earlier days still open. */
  leftovers(now: number): DueReminder[];
  /** Moves them to the same time today, or a little later when it has passed. */
  moveToToday(ids: string[], now: number): void;
}

interface BehaviorDeps {
  bus: EventBus<PetEvents>;
  state: PetState;
  controller: ActionController;
  registry: ActionRegistry;
  focus: FocusTimer;
  /** Returns a number in [0, 1). Injectable so random behavior can be tested. */
  random?: () => number;
  isIdleActionEnabled?: (id: string) => boolean;
  reminders?: ReminderSource;
  /**
   * True while the user switched on "勿扰": reminders then wait on the badge.
   * Quiet hours do not hold reminders back: the user chose their time.
   */
  holdsReminders?: (now: number) => boolean;
}

/**
 * Decides what the pet wants to do. It only requests actions; whether and how
 * they play is up to the ActionController.
 */
export class BehaviorEngine {
  private readonly random: () => number;
  private unsubscribers: Array<() => void> = [];
  private nextIdleActionAt = 0;
  /** How the pet feels today; told by `pet.mood`. */
  private mood: Mood = "calm";
  private dockSide: DockSide | null = null;
  /** The status row last sent, to send it only when it changed. */
  private shownBadge = "[]";
  /** Due reminders held back while it is quiet. */
  private waitingReminders = 0;
  /** Things going on outside the pet (a wait for a mail code, an agent at work): their chips and standing lines. */
  private readonly activities = new ActivityBoard();
  /** Reminders on the standing line, until the user clicks it away. */
  private alerted: DueReminder[] = [];
  /** When the pet last sat down to write because an agent set to work. */
  private agentWorkAt = Number.NEGATIVE_INFINITY;
  /** "Focus done" waits on the standing line too, after any reminders. */
  private focusNotice: string | null = null;
  /** Earlier reminders the morning greeting offered to move to today, until the user answers. */
  private moveOffer: DueReminder[] = [];
  /** A question about the focus round, ahead of everything else on the standing line: the user just asked. */
  private focusPrompt: { text: string; choices: AlertChoice[]; until: number } | null = null;
  /** The edge the pet left to call the user, and when to go back behind it. */
  private returnTo: { side: DockSide; at: number | null } | null = null;
  /** Actions held briefly by a non-interruptible wake-up or higher-priority action. */
  private pendingActions: Array<{ id: string; onAccepted?: () => void }> = [];
  /** The part of a conversation going on, and when to stop waiting for news of it. */
  private chat: { phase: keyof typeof BEHAVIOR_CONFIG.chatHoldMs; until: number } | null = null;
  /** A pose this engine put up that others may play too (think); tells its own from theirs. */
  private posed: string | null = null;
  private patStreak = { count: 0, at: 0 };
  /** When the user last touched the keyboard or mouse anywhere; unknown outside the desktop app. */
  private userActiveAt = -Infinity;
  /** When the pet dozed off for want of the user, so it wakes once they are back; null when it was told to sleep. */
  private dozedAt: number | null = null;
  /** The quiet stretch the pet has already yawned in, by the moment it began. */
  private yawnedFor: number | null = null;
  private lastCheerAt = -Infinity;
  private lastGlanceAt = -Infinity;
  private lastClickGlanceAt = -Infinity;

  constructor(private readonly deps: BehaviorDeps) {
    this.random = deps.random ?? Math.random;
  }

  start(): void {
    const { bus } = this.deps;
    this.unsubscribers = [
      bus.on("pet.clicked", () => this.onClicked()),
      bus.on("pet.petted", () => this.onPetted()),
      bus.on("pet.drag_started", () => this.onDragStarted()),
      bus.on("pet.drag_ended", ({ dockSide }) => this.onDragEnded(dockSide)),
      bus.on("pet.fed", () => this.onFed()),
      bus.on("pet.wooden_fish", () => this.onWoodenFish()),
      bus.on("pet.action_requested", ({ id }) => this.onActionRequested(id)),
      bus.on("pet.sleep", () => this.onSleepRequested()),
      bus.on("pet.wake_up", () => this.onWakeRequested()),
      bus.on("pet.focus_toggled", () => this.onFocusToggled()),
      bus.on("pet.focus_stopped", () => this.onFocusStopped()),
      bus.on("pet.focus_badge_clicked", () => this.onFocusBadgeClicked()),
      bus.on("pet.alert_dismissed", () => this.dismissAlert()),
      bus.on("pet.activity_open_requested", () => this.openActivity()),
      bus.on("pet.reminders_done", () => this.answerReminders("done")),
      bus.on("pet.reminders_snoozed", () => this.answerReminders("snoozed")),
      bus.on("pet.leftovers_moved", () => this.moveLeftovers()),
      // Asked to chat from the dock or the shortcut: come to the user as for a click.
      bus.on("pet.chat_requested", () => { this.rouse(); }),
      bus.on("pet.chat_phase", ({ phase }) => this.onChatPhase(phase)),
      bus.on("pet.noted", () => this.react(NOTE_ACTION)),
      bus.on("pet.item_done", () => this.onItemDone()),
      bus.on("pet.activity", (update) => this.onActivity(update)),
      bus.on("pet.hovered", () => this.onHovered()),
      bus.on("pet.user_active", ({ at }) => this.onUserActive(at)),
      // A pose that ran out, or a reaction that played over it: back into the pose without a blink of idle.
      bus.on("pet.action.completed", () => this.settle(Date.now())),
      bus.on("pet.mood", ({ mood }) => { this.mood = mood; }),
      bus.on("pet.greeting", ({ text, offerMove }) => {
        const now = Date.now();
        this.callOut(now, GREET_ACTION);
        this.say(text);
        if (offerMove) this.offerMove(now);
        if (this.returnTo) this.returnTo = { ...this.returnTo, at: now + BEHAVIOR_CONFIG.backToEdgeAfterGreetingMs };
      }),
    ];
    this.scheduleIdleAction(Date.now());
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  private deferAction(id: string, onAccepted?: () => void): void {
    const existing = this.pendingActions.find((action) => action.id === id);
    if (existing) {
      if (onAccepted) existing.onAccepted = onAccepted;
      return;
    }
    this.pendingActions.push({ id, onAccepted });
  }

  /** Runs the autonomous checks. Cheap enough to call about once a second. */
  tick(now: number): void {
    const { state, controller } = this.deps;
    this.advanceFocus(now);
    this.advanceReminders(now);
    this.trimMoveOffer(now);
    if (this.focusPrompt && now >= this.focusPrompt.until) this.clearFocusPrompt();
    this.showBadge(now);
    const idling = () => state.get().activity === "awake" && controller.current?.id === IDLE_ACTION;
    if (this.pendingActions.length > 0 && state.get().activity === "awake" && !this.dockSide) {
      const pending = this.pendingActions[0];
      const result = controller.request(pending.id);
      if (result.accepted) {
        this.pendingActions.shift();
        pending.onAccepted?.();
        return;
      }
      if (result.reason === "busy") return;
      this.pendingActions.shift();
    }
    this.settle(now);
    if (!idling()) return;
    const snapshot = state.get();
    // In a conversation or a focus round the pet keeps the user company: no wandering off, no dozing.
    if (this.inConversation(now) || this.heldPose(now) !== null) return;
    // Called out for a line that went away by itself (answered in the terminal, ticked off in the panel): back to the edge as after a click.
    if (this.returnTo?.at === null && !this.hasStandingLine()) this.returnTo = { ...this.returnTo, at: now + BEHAVIOR_CONFIG.backToEdgeAfterAlertMs };
    if (this.returnTo?.at != null && now >= this.returnTo.at && !this.hasStandingLine()) {
      const side = this.returnTo.side;
      this.returnTo = null;
      const result = controller.request(PEEK_ACTION);
      if (result.accepted && result.actionId === PEEK_ACTION) this.setDock(side);
      return;
    }

    // Working at the computer counts as being with the pet: it stays up while the user is around.
    const quietSince = Math.max(snapshot.lastInteractionAt, this.userActiveAt);
    const idleFor = now - quietSince;
    if (idleFor >= BEHAVIOR_CONFIG.sleepAfterIdleMs) {
      if (this.fallAsleep()) this.dozedAt = now;
      return;
    }
    if (idleFor >= BEHAVIOR_CONFIG.sleepAfterIdleMs - BEHAVIOR_CONFIG.yawnBeforeSleepMs && this.yawnedFor !== quietSince) {
      this.yawnedFor = quietSince;
      controller.request(YAWN_ACTION);
      return;
    }

    if (now >= this.nextIdleActionAt) {
      this.playRandomIdleAction();
      this.scheduleIdleAction(now);
    }
  }

  /**
   * A click wakes the pet or brings it out from the edge. Awake and out, it looks up, so the click
   * shows it landed (the quick chat bar opens on it only when there is no chat button). Not during
   * a focus round: the pet keeps its pose.
   */
  private onClicked(): void {
    if (this.rouse()) return;
    const now = Date.now();
    const { controller, focus } = this.deps;
    // Already looking (the cursor just came onto it): that is answer enough.
    if (controller.current?.id === GLANCE_ACTION || now - this.lastClickGlanceAt < BEHAVIOR_CONFIG.clickGlanceGapMs || focus.get().phase === "focusing") return;
    this.lastClickGlanceAt = now;
    controller.request(GLANCE_ACTION);
  }

  /** A pat: count every deliberate pat, then react when the controller can play the matching action. */
  private onPetted(): void {
    const { state, controller } = this.deps;
    if (this.rouse()) return;
    const now = Date.now();
    const count = now - this.patStreak.at <= BEHAVIOR_CONFIG.patStreakMs ? this.patStreak.count + 1 : 1;
    const id = count >= BEHAVIOR_CONFIG.shyFromPat ? SHY_ACTION : PET_ACTION;
    this.patStreak = { count, at: now };
    const accepted = () => state.changeStats(BEHAVIOR_CONFIG.effects.pet);
    if (controller.current?.id === "wake_up") {
      this.deferAction(id, accepted);
      return;
    }
    const result = controller.request(id);
    if (result.accepted) accepted();
    else if (result.reason === "busy") this.deferAction(id, accepted);
  }

  /** True while the user is typing, a reply is awaited, or one is coming out. */
  private inConversation(now: number): boolean {
    if (this.chat && now >= this.chat.until) this.chat = null;
    return this.chat !== null;
  }

  /** The pose the pet should be holding now: thinking while a reply is awaited, else the focus round's. */
  private heldPose(now: number): string | null {
    if (this.inConversation(now) && this.chat?.phase === "thinking") return THINK_POSE;
    return this.deps.focus.get().phase === "focusing" ? FOCUS_ACTION : null;
  }

  /**
   * Puts the pet into the pose it should hold, or out of one it should not.
   * Only idling (fidgets included) and the engine's own poses give way: a
   * reaction plays out first, and a sleeping or hiding pet is left as it is.
   */
  private settle(now: number): void {
    const { state, controller, registry } = this.deps;
    const pose = this.heldPose(now);
    const current = controller.current?.id;
    const posing = current !== undefined && (ENGINE_POSES.has(current) || current === this.posed);
    if (!posing) this.posed = null;
    if (posing && current === pose) return;
    if (state.get().activity !== "awake" || this.dockSide) return;
    const idling = current === undefined || current === IDLE_ACTION || registry.get(current)?.category === BEHAVIOR_CONFIG.idleCategory;
    if (!idling && !posing) return;
    if (posing) controller.stop();
    if (pose === null) return;
    const result = controller.request(pose);
    if (result.accepted && result.actionId === pose) this.posed = pose;
  }

  /** Chat tool requests cannot replace a sustained pose or interrupt direct manipulation. */
  canPlayChatAction(): boolean {
    return this.deps.state.get().activity === "awake"
      && this.deps.focus.get().phase === "off"
      && this.dockSide === null;
  }

  private onChatPhase(phase: ChatPhase): void {
    const now = Date.now();
    const { state } = this.deps;
    if (phase === "idle" || phase === "failed") {
      this.chat = null;
      this.settle(now);
      if (phase === "failed") this.react(CONFUSED_ACTION);
      return;
    }
    state.markInteraction(now);
    // A message on its way is worth waking up for; typing alone lets the pet sleep on.
    if (phase !== "listening" && state.get().activity === "sleeping") this.wakeUp();
    this.chat = { phase, until: now + BEHAVIOR_CONFIG.chatHoldMs[phase] };
    this.settle(now);
  }

  /**
   * A passing reaction to something the user did in another window. The pet
   * shows it if it is up and about; it is not woken or fetched from the edge for it.
   */
  private react(id: string): void {
    const { state, controller } = this.deps;
    state.markInteraction(Date.now());
    if (state.get().activity !== "awake" || this.dockSide) return;
    if (controller.current?.id === "wake_up") {
      this.deferAction(id);
      return;
    }
    const result = controller.request(id);
    if (!result.accepted && result.reason === "busy") this.deferAction(id);
  }

  private onItemDone(): void {
    const now = Date.now();
    if (now - this.lastCheerAt < BEHAVIOR_CONFIG.cheerGapMs) return;
    this.lastCheerAt = now;
    this.react(DONE_ACTION);
  }

  /**
   * Something going on moved on. What waits for the user, or is done with a
   * result to tell, is worth coming out from the edge for; the rest is a passing
   * reaction. Neither a focus round nor "勿扰" holds these back: the user set them going.
   */
  private onActivity(update: ActivityUpdate): void {
    const now = Date.now();
    const shown = this.activities.notice();
    const agentsBusy = this.activities.running(AGENT_ICON);
    if (!this.activities.report(update)) return;
    this.showBadge(now);
    // Agents start and stop all day: only the first to get going is worth looking up for, and not again for a while.
    if (update.state === "running" && update.icon === AGENT_ICON && !agentsBusy && now - this.agentWorkAt > BEHAVIOR_CONFIG.agentWorkGapMs) {
      this.agentWorkAt = now;
      this.react(AGENT_WORK_ACTION);
    }
    const action = ACTIVITY_ACTIONS[update.state];
    // Worth coming out for when there is something to tell; a failure is not.
    if (action !== undefined && update.text && update.state !== "failed") this.callOut(now, action);
    else if (action !== undefined) this.react(action);
    // A success is said in passing, not stood on the line: the card at the pet's feet keeps it.
    // Called out from the edge for it, the pet stays out while it says it, as after a greeting.
    // One the user still needs (`keep`) stands on the line instead, and the pet stays out until it is clicked away.
    if (update.state === "done" && update.text && !update.keep) {
      this.say(update.text);
      if (this.returnTo) this.returnTo = { ...this.returnTo, at: now + BEHAVIOR_CONFIG.backToEdgeAfterGreetingMs };
    }
    if (this.activities.notice() !== shown) this.showAlert(now);
  }

  /** The cursor is not an interaction: the idle pet glances at it now and then, and still dozes off under it. */
  private onHovered(): void {
    const now = Date.now();
    const { state, controller, registry } = this.deps;
    if (now - this.lastGlanceAt < BEHAVIOR_CONFIG.glanceGapMs) return;
    const current = controller.current;
    const idling = current?.id === IDLE_ACTION || registry.get(current?.id ?? "")?.category === BEHAVIOR_CONFIG.idleCategory;
    if (state.get().activity !== "awake" || this.dockSide || !idling) return;
    this.lastGlanceAt = now;
    controller.request(GLANCE_ACTION);
  }

  /** The user is at the computer. A pet that dozed off while they were away wakes up; one told to sleep sleeps on. */
  private onUserActive(at: number): void {
    this.userActiveAt = Math.max(this.userActiveAt, at);
    if (this.dozedAt !== null && at > this.dozedAt && this.deps.state.get().activity === "sleeping") this.wakeUp();
  }

  /** Wakes the pet or coaxes it out from behind the edge. Returns whether it had to. */
  private rouse(): boolean {
    const { state, controller } = this.deps;
    state.markInteraction(Date.now());
    // The user came for the pet: it stays out.
    this.returnTo = null;
    if (state.get().activity === "sleeping") {
      this.wakeUp();
      return true;
    }
    if (!this.dockSide) return false;
    this.setDock(null);
    controller.stop();
    controller.request("happy");
    return true;
  }

  private onDragStarted(): void {
    const { state, controller } = this.deps;
    state.markInteraction(Date.now());
    this.returnTo = null;
    this.setDock(null);
    if (controller.current?.id === "wake_up") controller.stop();
    const result = controller.request(DRAG_ACTION);
    // Being picked up wakes the pet, but only if it visibly reacts to it.
    if (result.accepted && result.actionId === DRAG_ACTION) state.setActivity("awake");
  }

  private onDragEnded(dockSide: DockSide | null): void {
    const now = Date.now();
    const { state, controller } = this.deps;
    state.markInteraction(now);
    if (controller.current?.id === DRAG_ACTION) controller.stop();
    if (dockSide && state.get().activity === "awake" && this.pendingActions.length > 0) {
      // Put by the edge by the user: it goes there as soon as what is queued has played.
      this.returnTo = { side: dockSide, at: now };
      this.setDock(null);
      this.scheduleIdleAction(now);
      return;
    }
    if (dockSide && state.get().activity === "awake") {
      const result = controller.request(PEEK_ACTION);
      if (result.accepted && result.actionId === PEEK_ACTION) this.setDock(dockSide);
    }
    this.settle(now);
    this.scheduleIdleAction(now);
  }

  private setDock(side: DockSide | null): void {
    if (side === this.dockSide) return;
    this.dockSide = side;
    this.deps.bus.emit("pet.dock_changed", { side });
  }

  private onFed(): void {
    // Stats change only when the pet actually eats, so spamming the button does nothing.
    this.playForUser("eat", () => this.deps.state.changeStats(BEHAVIOR_CONFIG.effects.feed));
  }

  private onWoodenFish(): void {
    this.playForUser("wooden_fish");
  }

  private onActionRequested(id: string): void {
    this.playForUser(id);
  }

  /**
   * Plays an action the user asked for with a button. A sleeping pet wakes up
   * first and plays it once awake; a hiding one comes out for it.
   */
  private playForUser(id: string, onAccepted?: () => void): void {
    const { state, controller } = this.deps;
    state.markInteraction(Date.now());
    this.returnTo = null;
    if (state.get().activity === "sleeping") {
      this.deferAction(id, onAccepted);
      this.wakeUp();
      return;
    }
    if (controller.current?.id === "wake_up") {
      this.deferAction(id, onAccepted);
      return;
    }
    if (this.dockSide) {
      this.setDock(null);
      controller.stop();
    }
    const result = controller.request(id);
    if (result.accepted) onAccepted?.();
    else if (result.reason === "busy") this.deferAction(id, onAccepted);
  }

  private onSleepRequested(): void {
    this.deps.state.markInteraction(Date.now());
    if (this.deps.state.get().activity === "awake") {
      this.endFocus();
      this.fallAsleep();
    }
  }

  private onFocusToggled(): void {
    const now = Date.now();
    const { state, controller, focus } = this.deps;
    state.markInteraction(now);
    this.returnTo = null;
    // A sleeping pet wakes up and starts the round; the tick settles it into the focus pose.
    if (state.get().activity === "sleeping") this.wakeUp();
    if (focus.get().phase === "focusing") {
      // Stopping throws the round away, so a press only asks, with buttons that do not run out.
      this.askAboutFocus(now);
      return;
    }
    this.clearFocusPrompt();
    this.clearFocusNotice();
    if (this.dockSide) {
      this.setDock(null);
      controller.stop();
    }
    focus.startFocus(now);
    this.say(FOCUS_LINES.started);
    this.showBadge(now);
    controller.request(FOCUS_ACTION);
  }

  /** The stop confirmed (or not needed, early in a round), or a rest ended from the menu. */
  private onFocusStopped(): void {
    const { state, focus } = this.deps;
    state.markInteraction(Date.now());
    const wasFocusing = focus.get().phase === "focusing";
    this.clearFocusPrompt();
    this.endFocus();
    if (wasFocusing) this.say(FOCUS_LINES.stopped);
  }

  /** The countdown at the pet's feet: asks whether to stop the round, or to cut the rest short. */
  private onFocusBadgeClicked(): void {
    const now = Date.now();
    this.deps.state.markInteraction(now);
    this.askAboutFocus(now);
  }

  private askAboutFocus(now: number): void {
    const { phase, endsAt } = this.deps.focus.get();
    if (phase === "off" || endsAt === null) return;
    const until = now + BEHAVIOR_CONFIG.focusPromptMs;
    if (phase === "focusing") {
      const focused = FOCUS_CONFIG.focusMs - (endsAt - now);
      if (focused < BEHAVIOR_CONFIG.focusFreeStopMs) {
        this.onFocusStopped();
        return;
      }
      this.focusPrompt = { text: FOCUS_LINES.askStop(Math.floor(focused / 60_000)), choices: FOCUS_CHOICES.stop, until };
    } else {
      const minutes = Math.max(1, Math.ceil((endsAt - now) / 60_000));
      this.focusPrompt = { text: FOCUS_LINES.askRest(minutes), choices: FOCUS_CHOICES.rest, until };
    }
    this.showAlert(now);
  }

  private clearFocusPrompt(): void {
    if (this.focusPrompt === null) return;
    this.focusPrompt = null;
    this.showAlert(Date.now());
  }

  private hasStandingLine(): boolean {
    return this.standing() !== null;
  }

  /**
   * What the standing line shows now. The one line goes to what the user must act on and has nowhere
   * else to see: a question they just asked, then due reminders (an agent waiting for the user still
   * has its amber card), then activities, the offer to move reminders, and "focus done".
   */
  private standing(): Standing | null {
    if (this.focusPrompt) return "focusPrompt";
    if (this.alerted.length > 0) return "reminders";
    if (this.activities.notice()) return "activity";
    if (this.moveOffer.length > 0) return "moveOffer";
    if (this.focusNotice !== null) return "focusNotice";
    return null;
  }

  /** How many lines wait behind the one shown. */
  private queued(): number {
    const lines = Number(this.focusPrompt !== null) + Number(this.alerted.length > 0) + this.activities.noticeCount()
      + Number(this.moveOffer.length > 0) + Number(this.focusNotice !== null);
    return Math.max(lines - 1, 0);
  }

  private advanceFocus(now: number): void {
    const { state, controller, focus } = this.deps;
    const transition = focus.advance(now);
    // A question about the phase that just ended no longer applies.
    if (transition !== null) this.clearFocusPrompt();
    if (transition === "focus_finished") {
      // Finishing counts as being with the user, so the rest does not start with a nap.
      state.markInteraction(now);
      if (controller.current?.id === FOCUS_ACTION) controller.stop();
      if (controller.request(FOCUS_DONE_ACTION).accepted) state.changeStats(BEHAVIOR_CONFIG.effects.focusDone);
      // It stays up until the user clicks it, like a reminder: they may have looked away.
      this.focusNotice = FOCUS_LINES.finished;
      this.showAlert(now);
      this.deps.bus.emit("pet.focus_completed", {});
    } else if (transition === "focus_interrupted") {
      if (controller.current?.id === FOCUS_ACTION) controller.stop();
      // The user was away: a passing line would be gone before they are back.
      this.focusNotice = FOCUS_LINES.interrupted;
      this.showAlert(now);
    } else if (transition === "rest_finished") {
      state.markInteraction(now);
      this.say(FOCUS_LINES.restOver);
    }
  }

  /**
   * Puts due reminders on a standing line that stays until the user clicks it,
   * or only counts them on the badge while it is quiet or focusing. A reminder counts as
   * seen only once the line is dismissed, so it comes back after a restart.
   */
  private advanceReminders(now: number): void {
    const { reminders, holdsReminders } = this.deps;
    if (!reminders) return;
    const due = reminders.due(now);
    const isShown = (reminder: DueReminder) => this.alerted.some((shown) => shown.id === reminder.id);
    // Items ticked off or removed elsewhere leave the line.
    const kept = this.alerted.filter((shown) => due.some((reminder) => reminder.id === shown.id));
    const fresh = due.filter((reminder) => !isShown(reminder));
    // A focus round holds them like "勿扰" does: counted on the badge, called out once the round is over.
    const held = fresh.length > 0 && ((holdsReminders?.(now) ?? false) || this.deps.focus.get().phase === "focusing");
    this.waitingReminders = held ? fresh.length : 0;
    if (fresh.length > 0 && !held) {
      this.callOut(now, REMIND_ACTION);
      this.alerted = [...kept, ...fresh];
      this.showAlert(now);
    } else if (kept.length !== this.alerted.length) {
      this.alerted = kept;
      this.showAlert(now);
    }
  }

  /** Puts what `standing` picks on the standing line, saying how many more wait behind it. */
  private showAlert(now: number): void {
    const queued = this.queued();
    const more = queued > 0 ? { queued } : {};
    const emit = (alert: PetEvents["pet.alert"]) => this.deps.bus.emit("pet.alert", { ...alert, ...more });
    switch (this.standing()) {
      case "focusPrompt": {
        const prompt = this.focusPrompt!;
        // Only a press asks it, right after "好，我陪你专注…" perhaps: the user is waiting for it.
        emit({ text: prompt.text, icon: "timer", choices: prompt.choices, immediate: true });
        return;
      }
      case "reminders": {
        const shown = this.alerted;
        const late = shown.some((reminder) => reminder.remindAt !== null && now - reminder.remindAt > BEHAVIOR_CONFIG.reminderLateMs);
        const texts = shown.map((reminder) => reminder.text);
        if (texts.length > MAX_NAMED_REMINDERS) {
          emit({ heading: REMINDER_LINES.late, text: REMINDER_LINES.many(texts.slice(0, MAX_NAMED_REMINDERS), texts.length), more: true });
          return;
        }
        emit({ heading: late ? REMINDER_LINES.late : REMINDER_LINES.onTime, text: REMINDER_LINES.named(texts), choices: reminderChoices(texts.length) });
        return;
      }
      case "activity": {
        const activity = this.activities.notice()!;
        const choices = activity.opens ? { choices: [ACTIVITY_DISMISS, { label: activity.opens, event: "pet.activity_open_requested" } satisfies AlertChoice] } : {};
        emit({ text: activity.text!, icon: activity.icon, ...choices });
        return;
      }
      case "moveOffer":
        emit({ heading: MOVE_LINES.heading, text: MOVE_LINES.named(this.moveOffer.map((reminder) => reminder.text)), choices: MOVE_CHOICES });
        return;
      case "focusNotice":
        emit({ text: this.focusNotice!, icon: "timer" });
        return;
      case null:
        this.deps.bus.emit("pet.alert", { text: null });
    }
  }

  /**
   * "完成" or "稍后提醒" on the reminder line. Only the reminder line has these
   * buttons, so nothing happens while another line covers it. Ticking off needs
   * no cheer here: the saved change comes back as `pet.item_done`.
   */
  private answerReminders(answer: "done" | "snoozed"): void {
    const { reminders, state } = this.deps;
    if (!reminders || this.standing() !== "reminders") return;
    const now = Date.now();
    const ids = this.alerted.map((reminder) => reminder.id);
    if (answer === "done") {
      reminders.complete(ids, now);
    } else {
      reminders.snooze(ids, now + BEHAVIOR_CONFIG.snoozeMs, now);
      this.say(REMINDER_LINES.snoozed(BEHAVIOR_CONFIG.snoozeMs / 60_000));
    }
    this.alerted = [];
    state.markInteraction(now);
    this.showAlert(now);
    if (this.returnTo) this.returnTo = { ...this.returnTo, at: now + BEHAVIOR_CONFIG.backToEdgeAfterAlertMs };
  }

  /** After the morning greeting: offers to move earlier reminders still open to today. */
  private offerMove(now: number): void {
    const leftovers = this.deps.reminders?.leftovers(now) ?? [];
    if (leftovers.length === 0) return;
    this.moveOffer = leftovers;
    this.showAlert(now);
  }

  /** Reminders ticked off or removed elsewhere leave the offer. */
  private trimMoveOffer(now: number): void {
    if (this.moveOffer.length === 0 || !this.deps.reminders) return;
    const still = new Set(this.deps.reminders.leftovers(now).map((reminder) => reminder.id));
    const kept = this.moveOffer.filter((reminder) => still.has(reminder.id));
    if (kept.length === this.moveOffer.length) return;
    this.moveOffer = kept;
    this.showAlert(now);
  }

  /** "挪到今天": only while the offer is what the line shows. */
  private moveLeftovers(): void {
    const { reminders, state } = this.deps;
    if (!reminders || this.standing() !== "moveOffer") return;
    const now = Date.now();
    reminders.moveToToday(this.moveOffer.map((reminder) => reminder.id), now);
    this.moveOffer = [];
    state.markInteraction(now);
    this.say(MOVE_LINES.moved);
    this.showAlert(now);
    if (this.returnTo) this.returnTo = { ...this.returnTo, at: now + BEHAVIOR_CONFIG.backToEdgeAfterAlertMs };
  }

  /** The user asked to go to the activity on the standing line: its reporter takes them there, and the line is put away. */
  private openActivity(): void {
    const top = this.activities.notice();
    if (top === null || this.standing() !== "activity") return;
    this.deps.bus.emit("pet.activity_opened", { id: top.id });
    this.dismissAlert();
  }

  /** Takes down what the standing line shows; what was waiting behind it comes up next. */
  private dismissAlert(): void {
    const now = Date.now();
    switch (this.standing()) {
      case "focusPrompt":
        this.clearFocusPrompt();
        return;
      case "reminders":
        this.deps.reminders?.markReminded(this.alerted.map((reminder) => reminder.id), now);
        this.alerted = [];
        break;
      case "activity":
        this.activities.dismiss();
        break;
      case "moveOffer":
        this.moveOffer = [];
        break;
      case "focusNotice":
        this.focusNotice = null;
        break;
      case null:
        return;
    }
    this.deps.state.markInteraction(now);
    this.showAlert(now);
    if (this.returnTo) this.returnTo = { ...this.returnTo, at: now + BEHAVIOR_CONFIG.backToEdgeAfterAlertMs };
  }

  private clearFocusNotice(): void {
    if (this.focusNotice === null) return;
    this.focusNotice = null;
    this.showAlert(Date.now());
  }

  /**
   * Gets the pet's attention onto the user: wakes it, brings it out from the
   * edge and plays `action`. It remembers the edge, to go back once the user has seen it.
   */
  private callOut(now: number, action: string): void {
    const { state, controller } = this.deps;
    state.markInteraction(now);
    if (this.dockSide) {
      this.returnTo = { side: this.dockSide, at: null };
      this.setDock(null);
      controller.stop();
    }
    if (state.get().activity === "sleeping") {
      this.deferAction(action);
      this.wakeUp();
      return;
    }
    if (controller.current?.id === "wake_up") {
      this.deferAction(action);
      return;
    }
    const result = controller.request(action);
    if (!result.accepted && result.reason === "busy") this.deferAction(action);
  }

  /** Stops a running round or rest and leaves the focus pose. */
  private endFocus(): void {
    const { controller, focus } = this.deps;
    if (focus.get().phase === "off") return;
    focus.stop();
    this.clearFocusPrompt();
    this.showBadge(Date.now());
    if (controller.current?.id === FOCUS_ACTION) controller.stop();
  }

  private showBadge(now: number): void {
    const focus = this.deps.focus.get();
    const countdown = focusBadge(focus, now);
    const progress = focusProgress(focus, now);
    const chips: StatusChip[] = [];
    if (countdown !== null && progress !== null) chips.push({ id: focus.phase === "resting" ? "rest" : "focus", label: countdown, progress });
    if (this.waitingReminders > 0) chips.push({ id: "reminders", label: REMINDER_LINES.badge(this.waitingReminders) });
    if (this.deps.holdsReminders?.(now) ?? false) chips.push({ id: "dnd", label: REMINDER_LINES.doNotDisturb });
    chips.push(...this.activities.chips());
    const key = JSON.stringify(chips);
    if (key === this.shownBadge) return;
    this.shownBadge = key;
    this.deps.bus.emit("pet.badge", { chips });
  }

  private say(text: string): void {
    this.deps.bus.emit("pet.say", { text });
  }

  private onWakeRequested(): void {
    this.deps.state.markInteraction(Date.now());
    if (this.deps.state.get().activity === "sleeping") this.wakeUp();
  }

  private fallAsleep(): boolean {
    if (!this.deps.controller.request("sleep").accepted) return false;
    this.deps.state.setActivity("sleeping");
    this.dozedAt = null;
    return true;
  }

  private wakeUp(animate = true): void {
    const { state, controller } = this.deps;
    this.dozedAt = null;
    state.setActivity("awake");
    // Leave the sleep loop first so waking works even without a wake-up animation.
    controller.stop();
    if (animate) controller.request("wake_up");
    this.scheduleIdleAction(Date.now());
  }

  private playRandomIdleAction(): void {
    if (this.mood === "tired" && this.random() < BEHAVIOR_CONFIG.tiredYawnChance && this.deps.controller.request(YAWN_ACTION).accepted) return;
    const pool = this.deps.registry.list().filter((action) => action.category === BEHAVIOR_CONFIG.idleCategory && (this.deps.isIdleActionEnabled?.(action.id) ?? true));
    if (pool.length === 0) return;
    const pick = pool[Math.floor(this.random() * pool.length)];
    this.deps.controller.request(pick.id);
  }

  private scheduleIdleAction(now: number): void {
    const { min, max } = BEHAVIOR_CONFIG.idleActionIntervalMs;
    this.nextIdleActionAt = now + (min + this.random() * (max - min)) * BEHAVIOR_CONFIG.idlePace[this.mood];
  }
}
