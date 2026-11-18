import type { ActionController } from "../actions/ActionController";
import { IDLE_ACTION, type ActionRegistry } from "../actions/ActionRegistry";
import type { EventBus } from "../core/EventBus";
import type { PetState } from "../core/PetState";
import type { ChatPhase, DockSide, MailCodeUpdate, PetEvents, PetStats } from "../types";
import { FOCUS_CONFIG, focusBadge, type FocusTimer } from "./FocusTimer";

/** Played while the user carries the pet around. */
const DRAG_ACTION = "drag";
/** Played while the pet hides behind a screen edge. */
const PEEK_ACTION = "peek";
/** Held while the pet keeps the user company during a focus round. */
const FOCUS_ACTION = "focus";
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
/** Played when a reply, a voice transcription or a wait for a mail code failed. */
const CONFUSED_ACTION = "confused";
/** Played when a verification code from the mailbox is copied for the user. */
const CODE_FOUND_ACTION = "happy";
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
  confirmStop: "再点一次就停止专注",
  stopped: "好，先停一下，随时再开始。",
  finished: "专注完成！辛苦啦，起来活动一下吧～",
  interrupted: "电脑刚才睡着了，这轮专注先不算，随时再开始。",
  restOver: "休息好啦，要不要再来一轮？",
};

/** A line names this many reminders at most; more are counted, and a click opens the panel. */
const MAX_NAMED_REMINDERS = 2;
const REMINDER_LINES = {
  onTime: (texts: string[]) => `到点啦：${texts.join("、")}`,
  late: (texts: string[]) => `别忘了：${texts.join("、")}`,
  many: (texts: string[], count: number) => `别忘了：${texts.join("、")} 等 ${count} 件`,
  badge: (count: number) => `提醒 ${count}`,
  doNotDisturb: "勿扰",
};

/** What the pet says about "查收验证码". The native side has already copied a found code. */
const MAIL_CODE_LINES = {
  badge: "等验证码…",
  found: (code: string, sender: string) => `验证码 ${code}，已复制（${sender}）`,
  notCopied: (code: string, sender: string) => `验证码 ${code}（${sender}），没能复制，手动输一下吧`,
  unrecognized: (sender: string) => `收到一封验证码邮件（${sender}），但我没认出码，去邮箱看一眼吧`,
  timeout: "一直没等到验证码，可以再点一次查收",
  unset: "先在设置里加个 163 邮箱吧",
};

export const BEHAVIOR_CONFIG = {
  /** Actions in this category are played at random while the pet is idle. */
  idleCategory: "idle",
  /** Shortest and longest wait between two random idle actions. */
  idleActionIntervalMs: { min: 6_000, max: 14_000 },
  /** The pet falls asleep after this long without interaction. */
  sleepAfterIdleMs: 5 * 60_000,
  effects: {
    feed: { satiety: 25, mood: 5, affinity: 1 },
    pet: { mood: 3, affinity: 2 },
    focusDone: { mood: 5, affinity: 2 },
  } satisfies Record<string, Partial<PetStats>>,
  /** A reminder announced this long after its time is worded as a late one. */
  reminderLateMs: 10 * 60_000,
  /** A second press of the focus button within this time stops the round. */
  confirmStopMs: 4_000,
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
};

/** A reminder whose time has come. */
export interface DueReminder {
  id: string;
  text: string;
  remindAt: number | null;
}

/** Where reminders come from. The pet only reads them and records that the user saw them. */
export interface ReminderSource {
  due(now: number): DueReminder[];
  markReminded(ids: string[], now: number): void;
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
  private dockSide: DockSide | null = null;
  private shownBadge: string | null = null;
  /** Due reminders held back while it is quiet. */
  private waitingReminders = 0;
  /** True while "查收验证码" waits for mail; shown on the badge. */
  private waitingForCode = false;
  /** Reminders on the standing line, until the user clicks it away. */
  private alerted: DueReminder[] = [];
  /** "Focus done" waits on the standing line too, after any reminders. */
  private focusNotice: string | null = null;
  /** The edge the pet left to call the user, and when to go back behind it. */
  private returnTo: { side: DockSide; at: number | null } | null = null;
  /** An action asked for while the pet slept, played once it is awake and idle. */
  private pendingAction: { id: string; onAccepted?: () => void } | null = null;
  /** When the focus button was last pressed during a round, to ask before stopping. */
  private stopAskedAt: number | null = null;
  /** The part of a conversation going on, and when to stop waiting for news of it. */
  private chat: { phase: keyof typeof BEHAVIOR_CONFIG.chatHoldMs; until: number } | null = null;
  /** A pose this engine put up that others may play too (think); tells its own from theirs. */
  private posed: string | null = null;
  private patStreak = { count: 0, at: 0 };
  /** The idle stretch the pet has already yawned in, by the interaction that began it. */
  private yawnedFor: number | null = null;
  private lastCheerAt = -Infinity;
  private lastGlanceAt = -Infinity;

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
      bus.on("pet.alert_dismissed", () => this.dismissAlert()),
      // Asked to chat from the dock or the shortcut: come to the user as for a click.
      bus.on("pet.chat_requested", () => { this.rouse(); }),
      bus.on("pet.chat_phase", ({ phase }) => this.onChatPhase(phase)),
      bus.on("pet.noted", () => this.react(NOTE_ACTION)),
      bus.on("pet.item_done", () => this.onItemDone()),
      bus.on("pet.mail_code", (update) => this.onMailCode(update)),
      bus.on("pet.hovered", () => this.onHovered()),
      // A pose that ran out, or a reaction that played over it: back into the pose without a blink of idle.
      bus.on("pet.action.completed", () => this.settle(Date.now())),
      bus.on("pet.greeting", ({ text }) => {
        const now = Date.now();
        this.callOut(now, GREET_ACTION);
        this.say(text);
        if (this.returnTo) this.returnTo = { ...this.returnTo, at: now + BEHAVIOR_CONFIG.backToEdgeAfterGreetingMs };
      }),
    ];
    this.scheduleIdleAction(Date.now());
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  /** Runs the autonomous checks. Cheap enough to call about once a second. */
  tick(now: number): void {
    const { state, controller } = this.deps;
    this.advanceFocus(now);
    this.advanceReminders(now);
    this.showBadge(now);
    const idling = () => state.get().activity === "awake" && controller.current?.id === IDLE_ACTION;
    if (idling() && this.pendingAction) {
      const { id, onAccepted } = this.pendingAction;
      this.pendingAction = null;
      if (controller.request(id).accepted) onAccepted?.();
      return;
    }
    this.settle(now);
    if (!idling()) return;
    const snapshot = state.get();
    // In a conversation or a focus round the pet keeps the user company: no wandering off, no dozing.
    if (this.inConversation(now) || this.heldPose(now) !== null) return;
    if (this.returnTo?.at != null && now >= this.returnTo.at && this.alerted.length === 0 && this.focusNotice === null) {
      const side = this.returnTo.side;
      this.returnTo = null;
      const result = controller.request(PEEK_ACTION);
      if (result.accepted && result.actionId === PEEK_ACTION) this.setDock(side);
      return;
    }

    const idleFor = now - snapshot.lastInteractionAt;
    if (idleFor >= BEHAVIOR_CONFIG.sleepAfterIdleMs) {
      this.fallAsleep();
      return;
    }
    if (idleFor >= BEHAVIOR_CONFIG.sleepAfterIdleMs - BEHAVIOR_CONFIG.yawnBeforeSleepMs && this.yawnedFor !== snapshot.lastInteractionAt) {
      this.yawnedFor = snapshot.lastInteractionAt;
      controller.request(YAWN_ACTION);
      return;
    }

    if (now >= this.nextIdleActionAt) {
      this.playRandomIdleAction();
      this.scheduleIdleAction(now);
    }
  }

  /** A click opens the quick chat bar; here it only gets the pet's attention. */
  private onClicked(): void {
    this.rouse();
  }

  /** A pat: the pet reacts once it is awake and out in the open, and turns shy when the pats keep coming. */
  private onPetted(): void {
    const { state, controller } = this.deps;
    if (this.rouse()) return;
    const now = Date.now();
    const count = now - this.patStreak.at <= BEHAVIOR_CONFIG.patStreakMs ? this.patStreak.count + 1 : 1;
    if (!controller.request(count >= BEHAVIOR_CONFIG.shyFromPat ? SHY_ACTION : PET_ACTION).accepted) return;
    this.patStreak = { count, at: now };
    state.changeStats(BEHAVIOR_CONFIG.effects.pet);
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
    if (state.get().activity === "awake" && !this.dockSide) controller.request(id);
  }

  private onItemDone(): void {
    const now = Date.now();
    if (now - this.lastCheerAt < BEHAVIOR_CONFIG.cheerGapMs) return;
    this.lastCheerAt = now;
    this.react(DONE_ACTION);
  }

  /**
   * The user asked for a code and is waiting for it, so a found one is worth
   * coming out from the edge for; anything else is a passing line.
   */
  private onMailCode(update: MailCodeUpdate): void {
    const now = Date.now();
    this.waitingForCode = update.kind === "waiting";
    this.showBadge(now);
    switch (update.kind) {
      case "waiting":
      case "cancelled":
        return;
      case "found":
        this.callOut(now, CODE_FOUND_ACTION);
        if (this.returnTo) this.returnTo = { ...this.returnTo, at: now + BEHAVIOR_CONFIG.backToEdgeAfterGreetingMs };
        this.say(update.copied ? MAIL_CODE_LINES.found(update.code, update.sender) : MAIL_CODE_LINES.notCopied(update.code, update.sender));
        return;
      case "unrecognized":
        this.react(CONFUSED_ACTION);
        this.say(MAIL_CODE_LINES.unrecognized(update.sender));
        return;
      case "timeout":
        this.react(CONFUSED_ACTION);
        this.say(MAIL_CODE_LINES.timeout);
        return;
      case "unset":
        this.say(MAIL_CODE_LINES.unset);
        return;
      case "failed":
        this.react(CONFUSED_ACTION);
        this.say(update.message);
        return;
    }
  }

  /** The cursor is not an interaction: the idle pet glances at it now and then, and still dozes off under it. */
  private onHovered(): void {
    const now = Date.now();
    const { state, controller } = this.deps;
    if (now - this.lastGlanceAt < BEHAVIOR_CONFIG.glanceGapMs) return;
    if (state.get().activity !== "awake" || this.dockSide || controller.current?.id !== IDLE_ACTION) return;
    this.lastGlanceAt = now;
    controller.request(GLANCE_ACTION);
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
    this.pendingAction = null;
    this.setDock(null);
    const result = controller.request(DRAG_ACTION);
    // Being picked up wakes the pet, but only if it visibly reacts to it.
    if (result.accepted && result.actionId === DRAG_ACTION) state.setActivity("awake");
  }

  private onDragEnded(dockSide: DockSide | null): void {
    const now = Date.now();
    const { state, controller } = this.deps;
    state.markInteraction(now);
    if (controller.current?.id === DRAG_ACTION) controller.stop();
    if (dockSide && state.get().activity === "awake") {
      const result = controller.request(PEEK_ACTION);
      if (result.accepted && result.actionId === PEEK_ACTION) this.setDock(dockSide);
    }
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
      this.wakeUp();
      this.pendingAction = { id, onAccepted };
      return;
    }
    if (this.dockSide) {
      this.setDock(null);
      controller.stop();
    }
    if (controller.request(id).accepted) onAccepted?.();
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
      // Stopping throws the round away, so the first press only asks.
      if (this.stopAskedAt === null || now - this.stopAskedAt > BEHAVIOR_CONFIG.confirmStopMs) {
        this.stopAskedAt = now;
        this.say(FOCUS_LINES.confirmStop);
        return;
      }
      this.stopAskedAt = null;
      this.endFocus();
      this.say(FOCUS_LINES.stopped);
      return;
    }
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

  /** From the menu: a deliberate pick, so no second press is asked for. */
  private onFocusStopped(): void {
    const { state, focus } = this.deps;
    state.markInteraction(Date.now());
    const wasFocusing = focus.get().phase === "focusing";
    this.stopAskedAt = null;
    this.endFocus();
    if (wasFocusing) this.say(FOCUS_LINES.stopped);
  }

  private advanceFocus(now: number): void {
    const { state, controller, focus } = this.deps;
    const transition = focus.advance(now);
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
      this.say(FOCUS_LINES.interrupted);
    } else if (transition === "rest_finished") {
      state.markInteraction(now);
      this.say(FOCUS_LINES.restOver);
    }
  }

  /**
   * Puts due reminders on a standing line that stays until the user clicks it,
   * or only counts them on the badge while it is quiet. A reminder counts as
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
    const held = fresh.length > 0 && (holdsReminders?.(now) ?? false);
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

  /** Puts the reminders, or else the focus notice, on the standing line. */
  private showAlert(now: number): void {
    const shown = this.alerted;
    if (shown.length === 0) {
      this.deps.bus.emit("pet.alert", { text: this.focusNotice });
      return;
    }
    const late = shown.some((reminder) => reminder.remindAt !== null && now - reminder.remindAt > BEHAVIOR_CONFIG.reminderLateMs);
    const texts = shown.map((reminder) => reminder.text);
    if (texts.length > MAX_NAMED_REMINDERS) {
      this.deps.bus.emit("pet.alert", { text: REMINDER_LINES.many(texts.slice(0, MAX_NAMED_REMINDERS), texts.length), more: true });
      return;
    }
    this.deps.bus.emit("pet.alert", { text: late ? REMINDER_LINES.late(texts) : REMINDER_LINES.onTime(texts) });
  }

  private dismissAlert(): void {
    if (this.alerted.length === 0 && this.focusNotice === null) return;
    const now = Date.now();
    if (this.alerted.length > 0) this.deps.reminders?.markReminded(this.alerted.map((reminder) => reminder.id), now);
    this.deps.state.markInteraction(now);
    this.alerted = [];
    this.focusNotice = null;
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
    // The call-out itself wakes the pet: a wake-up animation would refuse it.
    if (state.get().activity === "sleeping") this.wakeUp(false);
    if (this.dockSide) {
      this.returnTo = { side: this.dockSide, at: null };
      this.setDock(null);
      controller.stop();
    }
    controller.request(action);
  }

  /** Stops a running round or rest and leaves the focus pose. */
  private endFocus(): void {
    const { controller, focus } = this.deps;
    if (focus.get().phase === "off") return;
    focus.stop();
    this.showBadge(Date.now());
    if (controller.current?.id === FOCUS_ACTION) controller.stop();
  }

  private showBadge(now: number): void {
    const doNotDisturb = this.deps.holdsReminders?.(now) ?? false;
    const parts = [
      focusBadge(this.deps.focus.get(), now),
      this.waitingReminders > 0 ? REMINDER_LINES.badge(this.waitingReminders) : null,
      doNotDisturb ? REMINDER_LINES.doNotDisturb : null,
      this.waitingForCode ? MAIL_CODE_LINES.badge : null,
    ];
    const badge = parts.filter((part) => part !== null).join(" · ") || null;
    if (badge === this.shownBadge) return;
    this.shownBadge = badge;
    this.deps.bus.emit("pet.badge", { text: badge });
  }

  private say(text: string): void {
    this.deps.bus.emit("pet.say", { text });
  }

  private onWakeRequested(): void {
    this.deps.state.markInteraction(Date.now());
    if (this.deps.state.get().activity === "sleeping") this.wakeUp();
  }

  private fallAsleep(): void {
    if (this.deps.controller.request("sleep").accepted) this.deps.state.setActivity("sleeping");
  }

  private wakeUp(animate = true): void {
    const { state, controller } = this.deps;
    state.setActivity("awake");
    // Leave the sleep loop first so waking works even without a wake-up animation.
    controller.stop();
    if (animate) controller.request("wake_up");
    this.scheduleIdleAction(Date.now());
  }

  private playRandomIdleAction(): void {
    const pool = this.deps.registry.list().filter((action) => action.category === BEHAVIOR_CONFIG.idleCategory && (this.deps.isIdleActionEnabled?.(action.id) ?? true));
    if (pool.length === 0) return;
    const pick = pool[Math.floor(this.random() * pool.length)];
    this.deps.controller.request(pick.id);
  }

  private scheduleIdleAction(now: number): void {
    const { min, max } = BEHAVIOR_CONFIG.idleActionIntervalMs;
    this.nextIdleActionAt = now + min + this.random() * (max - min);
  }
}
