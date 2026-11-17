import type { ActionController } from "../actions/ActionController";
import { IDLE_ACTION, type ActionRegistry } from "../actions/ActionRegistry";
import type { EventBus } from "../core/EventBus";
import type { PetState } from "../core/PetState";
import type { DockSide, PetEvents, PetStats } from "../types";
import { FOCUS_CONFIG, focusBadge, type FocusTimer } from "./FocusTimer";

/** Played while the user carries the pet around. */
const DRAG_ACTION = "drag";
/** Played while the pet hides behind a screen edge. */
const PEEK_ACTION = "peek";
/** Held while the pet keeps the user company during a focus round. */
const FOCUS_ACTION = "focus";
/** Played when the user pats the pet (long press or the menu). */
const PET_ACTION = "pet_reaction";
/** Played when a focus round is done. */
const FOCUS_DONE_ACTION = "happy";
/** Played to catch the user's eye for a reminder or a greeting. */
const CALL_OUT_ACTION = "happy";

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
      bus.on("pet.greeting", ({ text }) => {
        const now = Date.now();
        this.callOut(now);
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
    const { state, controller, focus } = this.deps;
    this.advanceFocus(now);
    this.advanceReminders(now);
    this.showBadge(now);
    const snapshot = state.get();
    if (snapshot.activity !== "awake" || controller.current?.id !== IDLE_ACTION) return;
    if (this.pendingAction) {
      const { id, onAccepted } = this.pendingAction;
      this.pendingAction = null;
      if (controller.request(id).accepted) onAccepted?.();
      return;
    }
    // While focusing the pet keeps the user company: no wandering off, no dozing.
    if (focus.get().phase === "focusing") {
      controller.request(FOCUS_ACTION);
      return;
    }
    if (this.returnTo?.at != null && now >= this.returnTo.at && this.alerted.length === 0 && this.focusNotice === null) {
      const side = this.returnTo.side;
      this.returnTo = null;
      const result = controller.request(PEEK_ACTION);
      if (result.accepted && result.actionId === PEEK_ACTION) this.setDock(side);
      return;
    }

    if (now - snapshot.lastInteractionAt >= BEHAVIOR_CONFIG.sleepAfterIdleMs) {
      this.fallAsleep();
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

  /** A pat: the pet reacts once it is awake and out in the open. */
  private onPetted(): void {
    const { state, controller } = this.deps;
    if (!this.rouse() && controller.request(PET_ACTION).accepted) state.changeStats(BEHAVIOR_CONFIG.effects.pet);
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
      this.callOut(now);
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
   * edge and cheers. It remembers the edge, to go back once the user has seen it.
   */
  private callOut(now: number): void {
    const { state, controller } = this.deps;
    state.markInteraction(now);
    if (state.get().activity === "sleeping") this.wakeUp();
    if (this.dockSide) {
      this.returnTo = { side: this.dockSide, at: null };
      this.setDock(null);
      controller.stop();
    }
    controller.request(CALL_OUT_ACTION);
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

  private wakeUp(): void {
    const { state, controller } = this.deps;
    state.setActivity("awake");
    // Leave the sleep loop first so waking works even without a wake-up animation.
    controller.stop();
    controller.request("wake_up");
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
