import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActionController } from "../actions/ActionController";
import { ActionRegistry } from "../actions/ActionRegistry";
import { EventBus } from "../core/EventBus";
import { createSnapshot, PetState } from "../core/PetState";
import { animationIds, FakeRenderer, makeManifest } from "../testing/fixtures";
import { mailCodeActivity } from "../activity/mailCodeActivity";
import type { ActivityUpdate, MailCodeUpdate, PetEvents, PetStats } from "../types";
import { BEHAVIOR_CONFIG, BehaviorEngine, type DueReminder, type ReminderSource } from "./BehaviorEngine";
import { FOCUS_CONFIG, FocusTimer } from "./FocusTimer";

const START_STATS: PetStats = { satiety: 50, energy: 50, mood: 50, affinity: 50 };

interface SetupOptions {
  stats?: Partial<PetStats>;
  extraAnimations?: unknown[];
  missing?: string[];
  random?: () => number;
  isIdleActionEnabled?: (id: string) => boolean;
  reminders?: ReminderSource;
  holdsReminders?: (now: number) => boolean;
}

function setup({ stats = {}, extraAnimations = [], missing = [], random = () => 0, isIdleActionEnabled, reminders, holdsReminders }: SetupOptions = {}) {
  const manifest = makeManifest(extraAnimations);
  const registry = new ActionRegistry();
  registry.registerManifest(manifest, animationIds(manifest, missing));
  const renderer = new FakeRenderer();
  const bus = new EventBus<PetEvents>();
  const docks: Array<string | null> = [];
  bus.on("pet.dock_changed", ({ side }) => docks.push(side));
  const said: string[] = [];
  const badges: Array<string | null> = [];
  bus.on("pet.say", ({ text }) => said.push(text));
  bus.on("pet.badge", ({ chips }) => badges.push(chips.length > 0 ? chips.map((chip) => chip.label).join(" · ") : null));
  const focus = new FocusTimer();
  const state = new PetState({ ...createSnapshot(Date.now()), stats: { ...START_STATS, ...stats } });
  const controller = new ActionController({ registry, renderer, bus });
  controller.stop();
  const engine = new BehaviorEngine({ bus, state, controller, registry, focus, random, isIdleActionEnabled, reminders, holdsReminders });
  engine.start();
  /** Moves time forward and runs the autonomous checks, as the runtime would. */
  const pass = (ms: number) => {
    vi.advanceTimersByTime(ms);
    engine.tick(Date.now());
  };
  /** Like `pass`, ticking every second on the way, as the runtime does while the computer is awake. */
  const passSteps = (ms: number) => {
    for (let done = 0; done < ms; done += 1000) pass(Math.min(1000, ms - done));
  };
  return { bus, state, controller, renderer, engine, pass, passSteps, docks, focus, said, badges };
}

/** The actions for conversations and passing reactions, as a full character has them. */
const SCENE_ACTIONS = [
  { id: "think", file: "a/idle.png", duration: 2400, priority: 10 },
  { id: "write", file: "a/idle.png", duration: 2200, priority: 20, cooldown: 3000 },
  { id: "remind", file: "a/happy.png", duration: 2400, priority: 40 },
  { id: "wave", file: "a/happy.png", duration: 2200, priority: 20 },
  { id: "yawn", file: "a/idle.png", duration: 2000, priority: 8 },
  { id: "confused", file: "a/idle.png", duration: 1800, priority: 20 },
  { id: "look_around", file: "a/idle.png", duration: 3200, category: "idle", priority: 5 },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("conversations", () => {
  const chatting = () => setup({ extraAnimations: SCENE_ACTIONS });

  it("thinks while waiting for the reply and stands free for the rest of the conversation", () => {
    const { bus, controller } = chatting();
    bus.emit("pet.chat_phase", { phase: "listening" });
    expect(controller.current?.id).toBe("idle");
    bus.emit("pet.chat_phase", { phase: "thinking" });
    expect(controller.current?.id).toBe("think");
    bus.emit("pet.chat_phase", { phase: "talking" });
    expect(controller.current?.id).toBe("idle");
    bus.emit("pet.chat_phase", { phase: "idle" });
    expect(controller.current?.id).toBe("idle");
  });

  it("lets an action the reply picked play out, without snapping into a pose after it", () => {
    const { bus, controller, pass } = chatting();
    bus.emit("pet.chat_phase", { phase: "talking" });
    bus.emit("pet.action_requested", { id: "wooden_fish" });
    bus.emit("pet.chat_phase", { phase: "listening" });
    expect(controller.current?.id).toBe("wooden_fish");
    pass(4_000);
    expect(controller.current?.id).toBe("idle");
  });

  it("keeps thinking for as long as the reply takes, without a blink of idle", () => {
    const { bus, controller, renderer, pass } = chatting();
    bus.emit("pet.chat_phase", { phase: "thinking" });
    const from = renderer.played.length;
    pass(2_400);
    pass(2_400);
    pass(1_000);
    expect(controller.current?.id).toBe("think");
    expect(renderer.played.slice(from)).toEqual(["think", "think"]);
  });

  it("lets a reaction play over the pose and returns to the pose", () => {
    const { bus, controller, pass } = chatting();
    bus.emit("pet.chat_phase", { phase: "thinking" });
    bus.emit("pet.noted", {});
    expect(controller.current?.id).toBe("write");
    pass(2_200);
    expect(controller.current?.id).toBe("think");
  });

  it("breaks off a fidget to pose", () => {
    const { bus, controller } = chatting();
    bus.emit("pet.hovered", {});
    expect(controller.current?.id).toBe("look_around");
    bus.emit("pet.chat_phase", { phase: "thinking" });
    expect(controller.current?.id).toBe("think");
  });

  it("leaves a thinking action someone else started alone", () => {
    const { bus, controller, pass } = chatting();
    bus.emit("pet.action_requested", { id: "think" });
    pass(1_000);
    expect(controller.current?.id).toBe("think");
  });

  it("poses for the conversation during a focus round and returns to the focus pose", () => {
    const { bus, controller } = chatting();
    bus.emit("pet.focus_toggled", {});
    expect(controller.current?.id).toBe("focus");
    bus.emit("pet.chat_phase", { phase: "thinking" });
    expect(controller.current?.id).toBe("think");
    bus.emit("pet.chat_phase", { phase: "idle" });
    expect(controller.current?.id).toBe("focus");
  });

  it("wakes up for a message on its way, not for typing", () => {
    const { bus, state, controller, pass } = chatting();
    bus.emit("pet.sleep", {});
    bus.emit("pet.chat_phase", { phase: "listening" });
    expect(state.get().activity).toBe("sleeping");
    bus.emit("pet.chat_phase", { phase: "thinking" });
    expect(state.get().activity).toBe("awake");
    expect(controller.current?.id).toBe("wake_up");
    pass(900);
    expect(controller.current?.id).toBe("think");
  });

  it("stays behind the edge through a conversation in another window", () => {
    const { bus, controller, docks } = chatting();
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "left" });
    bus.emit("pet.chat_phase", { phase: "thinking" });
    bus.emit("pet.chat_phase", { phase: "talking" });
    expect(controller.current?.id).toBe("peek");
    expect(docks).toEqual(["left"]);
  });

  it("comes out from the edge when asked to chat", () => {
    const { bus, controller, docks } = chatting();
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "left" });
    bus.emit("pet.chat_requested", {});
    expect(docks).toEqual(["left", null]);
    expect(controller.current?.id).toBe("happy");
  });

  it("looks confused when the reply fails", () => {
    const { bus, controller, pass } = chatting();
    bus.emit("pet.chat_phase", { phase: "thinking" });
    bus.emit("pet.chat_phase", { phase: "failed" });
    expect(controller.current?.id).toBe("confused");
    pass(1_800);
    expect(controller.current?.id).toBe("idle");
  });

  it("neither wanders off nor dozes while a conversation is going on", () => {
    const { bus, state, controller, pass, passSteps } = setup();
    bus.emit("pet.chat_phase", { phase: "talking" });
    expect(controller.current?.id).toBe("idle");
    passSteps(60_000);
    expect(controller.current?.id).toBe("idle");
    bus.emit("pet.chat_phase", { phase: "idle" });
    pass(BEHAVIOR_CONFIG.sleepAfterIdleMs);
    expect(state.get().activity).toBe("sleeping");
  });
});

describe("passing reactions", () => {
  const reacting = () => setup({ extraAnimations: SCENE_ACTIONS });

  it("writes down a reminder or a note with the user", () => {
    const { bus, controller } = reacting();
    bus.emit("pet.noted", {});
    expect(controller.current?.id).toBe("write");
  });

  it("is not woken or fetched from the edge for one", () => {
    const { bus, state, controller } = reacting();
    bus.emit("pet.sleep", {});
    bus.emit("pet.noted", {});
    expect(state.get().activity).toBe("sleeping");
    expect(controller.current?.id).toBe("sleep");
  });

  it("cheers for a ticked-off reminder, but not for every one of a batch", () => {
    const { bus, renderer, pass } = reacting();
    bus.emit("pet.item_done", {});
    pass(2_000);
    bus.emit("pet.item_done", {});
    pass(BEHAVIOR_CONFIG.cheerGapMs);
    bus.emit("pet.item_done", {});
    expect(renderer.played.filter((id) => id === "happy")).toHaveLength(2);
  });

  it("turns shy when the pats keep coming", () => {
    const { bus, controller, pass } = reacting();
    for (let pat = 1; pat < BEHAVIOR_CONFIG.shyFromPat; pat += 1) {
      bus.emit("pet.petted", {});
      expect(controller.current?.id).toBe("pet_reaction");
      pass(2_000);
    }
    bus.emit("pet.petted", {});
    expect(controller.current?.id).toBe("shy");
    pass(BEHAVIOR_CONFIG.patStreakMs + 1_600);
    bus.emit("pet.petted", {});
    expect(controller.current?.id).toBe("pet_reaction");
  });

  it("yawns once shortly before it falls asleep", () => {
    const { state, renderer, passSteps } = reacting();
    passSteps(BEHAVIOR_CONFIG.sleepAfterIdleMs - BEHAVIOR_CONFIG.yawnBeforeSleepMs - 1_000);
    expect(renderer.played).not.toContain("yawn");
    passSteps(BEHAVIOR_CONFIG.yawnBeforeSleepMs + 1_000);
    expect(renderer.played.filter((id) => id === "yawn")).toHaveLength(1);
    expect(state.get().activity).toBe("sleeping");
  });

  it("glances at the cursor now and then, and still dozes off under it", () => {
    const { bus, state, renderer, pass } = reacting();
    bus.emit("pet.hovered", {});
    expect(renderer.last).toBe("look_around");
    pass(3_200);
    bus.emit("pet.hovered", {});
    expect(renderer.played.filter((id) => id === "look_around")).toHaveLength(1);
    pass(BEHAVIOR_CONFIG.sleepAfterIdleMs);
    expect(state.get().activity).toBe("sleeping");
  });

  it("stays up while the user works at the computer, and dozes off once they leave", () => {
    const { bus, state, renderer, passSteps } = reacting();
    for (let report = 0; report < 60; report += 1) {
      bus.emit("pet.user_active", { at: Date.now() - 2_000 });
      passSteps(10_000);
    }
    expect(state.get().activity).toBe("awake");
    bus.emit("pet.user_active", { at: Date.now() });
    passSteps(BEHAVIOR_CONFIG.sleepAfterIdleMs - 1_000);
    expect(state.get().activity).toBe("awake");
    expect(renderer.played.filter((id) => id === "yawn")).toHaveLength(1);
    passSteps(1_000);
    expect(state.get().activity).toBe("sleeping");
  });

  it("wakes up when the user is back at the computer", () => {
    const { bus, state, renderer, passSteps } = reacting();
    bus.emit("pet.user_active", { at: Date.now() });
    passSteps(BEHAVIOR_CONFIG.sleepAfterIdleMs);
    expect(state.get().activity).toBe("sleeping");
    // The first reading after it dozed off still dates from before.
    bus.emit("pet.user_active", { at: Date.now() - BEHAVIOR_CONFIG.sleepAfterIdleMs });
    expect(state.get().activity).toBe("sleeping");
    passSteps(60_000);
    bus.emit("pet.user_active", { at: Date.now() });
    expect(state.get().activity).toBe("awake");
    expect(renderer.last).toBe("wake_up");
  });

  it("sleeps on when the user told it to, even while they work", () => {
    const { bus, state } = reacting();
    bus.emit("pet.sleep", {});
    bus.emit("pet.user_active", { at: Date.now() + 1_000 });
    expect(state.get().activity).toBe("sleeping");
  });

  it("glances at the cursor while an idle fidget is playing", () => {
    const { bus, controller } = reacting();
    bus.emit("pet.action_requested", { id: "blink" });
    expect(controller.current?.id).toBe("blink");
    bus.emit("pet.hovered", {});
    expect(controller.current?.id).toBe("look_around");
  });

  it("waves with a greeting", () => {
    const { bus, controller } = reacting();
    bus.emit("pet.greeting", { text: "早上好！" });
    expect(controller.current?.id).toBe("wave");
  });
});

describe("user interaction", () => {
  it("answers a pat with the petting reaction", () => {
    const { bus, state, renderer } = setup();
    bus.emit("pet.petted", {});
    expect(renderer.last).toBe("pet_reaction");
    expect(state.get().stats).toMatchObject({ mood: 53, affinity: 52 });
  });

  it("looks up at a plain click, once in a while, without the pat's stats", () => {
    const { bus, state, renderer } = setup({ extraAnimations: SCENE_ACTIONS });
    const start = Date.now();
    for (let click = 0; click < 3; click += 1) {
      bus.emit("pet.clicked", { region: "body" });
      vi.advanceTimersByTime(600);
    }
    expect(renderer.played.filter((id) => id === "look_around")).toHaveLength(1);
    expect(state.get().stats).toMatchObject({ mood: 50, affinity: 50 });
    expect(state.get().lastInteractionAt).toBeGreaterThan(start);
    vi.advanceTimersByTime(BEHAVIOR_CONFIG.clickGlanceGapMs);
    bus.emit("pet.clicked", { region: "body" });
    expect(renderer.played.filter((id) => id === "look_around")).toHaveLength(2);
  });

  it("answers a click even right after it glanced at the cursor", () => {
    const { bus, renderer, pass } = setup({ extraAnimations: SCENE_ACTIONS });
    bus.emit("pet.hovered", {});
    pass(3_200);
    bus.emit("pet.clicked", { region: "body" });
    expect(renderer.played.filter((id) => id === "look_around")).toHaveLength(2);
  });

  it("does not start over a glance it is already giving", () => {
    const { bus, renderer } = setup({ extraAnimations: SCENE_ACTIONS });
    bus.emit("pet.hovered", {});
    bus.emit("pet.clicked", { region: "body" });
    expect(renderer.played.filter((id) => id === "look_around")).toHaveLength(1);
  });

  it("keeps still at a click during a focus round", () => {
    const { bus, controller } = setup({ extraAnimations: SCENE_ACTIONS });
    bus.emit("pet.focus_toggled", {});
    const pose = controller.current?.id;
    bus.emit("pet.clicked", { region: "body" });
    expect(controller.current?.id).toBe(pose);
  });

  it("gives no stats for a pat the pet could not react to", () => {
    const { bus, state } = setup();
    bus.emit("pet.petted", {});
    vi.advanceTimersByTime(100);
    bus.emit("pet.petted", {});
    expect(state.get().stats.mood).toBe(53);
  });

  it("wakes up from a pat without the petting reaction", () => {
    const { bus, state, renderer } = setup();
    bus.emit("pet.sleep", {});
    bus.emit("pet.petted", {});
    expect(state.get().activity).toBe("awake");
    expect(renderer.played).not.toContain("pet_reaction");
  });

  it("reacts to a pat after an already-running wake-up animation", () => {
    const { bus, controller, state, pass } = setup();
    bus.emit("pet.sleep", {});
    bus.emit("pet.wake_up", {});
    bus.emit("pet.petted", {});
    expect(controller.current?.id).toBe("wake_up");
    pass(1_000);
    expect(controller.current?.id).toBe("pet_reaction");
    expect(state.get().stats.affinity).toBe(52);
  });

  it("feeds the pet", () => {
    const { bus, state, renderer } = setup();
    bus.emit("pet.fed", {});
    expect(renderer.last).toBe("eat");
    expect(state.get().stats).toMatchObject({ satiety: 75, mood: 55, affinity: 51 });
  });

  it("ignores feeding while the pet is still eating", () => {
    const { bus, state } = setup();
    bus.emit("pet.fed", {});
    vi.advanceTimersByTime(500);
    bus.emit("pet.fed", {});
    expect(state.get().stats.satiety).toBe(75);
  });

  it("knocks the wooden fish on request", () => {
    const { bus, state, renderer } = setup();
    vi.advanceTimersByTime(5000);
    bus.emit("pet.wooden_fish", {});
    expect(renderer.last).toBe("wooden_fish");
    expect(state.get().lastInteractionAt).toBe(Date.now());
  });

  it("knocks again on every press", () => {
    const { bus, renderer } = setup();
    bus.emit("pet.wooden_fish", {});
    vi.advanceTimersByTime(300);
    bus.emit("pet.wooden_fish", {});
    expect(renderer.played).toEqual(["idle", "wooden_fish", "wooden_fish"]);
  });

  it("records every interaction, including drags", () => {
    const { bus, state } = setup();
    vi.advanceTimersByTime(5000);
    bus.emit("pet.drag_started", {});
    expect(state.get().lastInteractionAt).toBe(Date.now());
  });
});

describe("being carried", () => {
  it("dangles while dragged and returns to idle when dropped", () => {
    const { bus, renderer, controller } = setup();
    bus.emit("pet.drag_started", {});
    expect(renderer.last).toBe("drag");

    bus.emit("pet.drag_ended", { dockSide: null });
    expect(controller.current?.id).toBe("idle");
  });

  it("interrupts a reaction when picked up", () => {
    const { bus, renderer } = setup();
    bus.emit("pet.fed", {});
    bus.emit("pet.drag_started", {});
    expect(renderer.last).toBe("drag");
  });

  it("wakes up when picked up", () => {
    const { bus, state, controller } = setup();
    bus.emit("pet.sleep", {});
    bus.emit("pet.drag_started", {});
    expect(state.get().activity).toBe("awake");

    bus.emit("pet.drag_ended", { dockSide: null });
    expect(controller.current?.id).toBe("idle");
  });

  it("starts the drag action if picked up during wake-up", () => {
    const { bus, controller } = setup();
    bus.emit("pet.sleep", {});
    bus.emit("pet.wake_up", {});
    bus.emit("pet.drag_started", {});
    expect(controller.current?.id).toBe("drag");
  });

  it("keeps sleeping when the pack has no drag animation", () => {
    const { bus, state, renderer } = setup({ missing: ["drag"] });
    bus.emit("pet.sleep", {});
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: null });
    expect(state.get().activity).toBe("sleeping");
    expect(renderer.last).toBe("sleep");
  });

  it("does not act on its own while carried", () => {
    const { bus, renderer, pass } = setup();
    bus.emit("pet.drag_started", {});
    pass(BEHAVIOR_CONFIG.sleepAfterIdleMs);
    expect(renderer.last).toBe("drag");
  });
});

describe("hiding behind a screen edge", () => {
  it("peeks out when dropped against an edge", () => {
    const { bus, renderer, docks } = setup();
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "right" });
    expect(renderer.last).toBe("peek");
    expect(docks).toEqual(["right"]);
  });

  it("stays hidden until the user comes back", () => {
    const { bus, renderer, state, pass } = setup();
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "left" });
    pass(BEHAVIOR_CONFIG.sleepAfterIdleMs);
    expect(renderer.last).toBe("peek");
    expect(state.get().activity).toBe("awake");
  });

  it("comes out happily when clicked, without the usual click rewards", () => {
    const { bus, renderer, state, docks } = setup();
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "left" });
    bus.emit("pet.clicked", { region: "head" });
    expect(renderer.last).toBe("happy");
    expect(docks).toEqual(["left", null]);
    expect(state.get().stats.affinity).toBe(50);
  });

  it("leaves the edge when picked up again", () => {
    const { bus, renderer, docks } = setup();
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "left" });
    bus.emit("pet.drag_started", {});
    expect(renderer.last).toBe("drag");
    expect(docks).toEqual(["left", null]);
  });

  it("cannot be put to sleep while hidden", () => {
    const { bus, renderer, state } = setup();
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "left" });
    bus.emit("pet.sleep", {});
    expect(renderer.last).toBe("peek");
    expect(state.get().activity).toBe("awake");
  });

  it("comes out from the edge when fed", () => {
    const { bus, renderer, docks, state } = setup();
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "left" });
    bus.emit("pet.fed", {});
    expect(docks).toEqual(["left", null]);
    expect(renderer.last).toBe("eat");
    expect(state.get().stats.satiety).toBe(75);
  });

  it("just stands at the edge when the pack has no peek animation", () => {
    const { bus, controller, docks } = setup({ missing: ["peek"] });
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "left" });
    expect(controller.current?.id).toBe("idle");
    expect(docks).toEqual([]);
  });

  it("goes back to the edge when the line it came out for goes away by itself", () => {
    const { bus, docks, passSteps } = setup({ extraAnimations: SCENE_ACTIONS });
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "right" });
    bus.emit("pet.activity", { id: "claude:1", state: "waiting", label: "Claude", icon: "agent", text: "要你确认" });
    expect(docks).toEqual(["right", null]);
    // Answered in the terminal: the line goes, nobody clicked it.
    bus.emit("pet.activity", { id: "claude:1", state: "running", label: "Claude", icon: "agent" });
    passSteps(10_000);
    expect(docks).toEqual(["right", null, "right"]);
  });

  it("goes to the edge it was dropped at once a queued reaction has played", () => {
    const { bus, controller, docks, passSteps } = setup({ extraAnimations: SCENE_ACTIONS });
    controller.request("remind");
    bus.emit("pet.noted", {});
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "left" });
    passSteps(10_000);
    expect(docks).toEqual(["left"]);
    expect(controller.current?.id).toBe("peek");
  });
});

describe("sleeping and waking", () => {
  it("falls asleep on request", () => {
    const { bus, state, renderer } = setup();
    bus.emit("pet.sleep", {});
    expect(state.get().activity).toBe("sleeping");
    expect(renderer.last).toBe("sleep");
  });

  it("wakes up on request and returns to idle", () => {
    const { bus, state, renderer, controller } = setup();
    bus.emit("pet.sleep", {});
    bus.emit("pet.wake_up", {});
    expect(state.get().activity).toBe("awake");
    expect(renderer.last).toBe("wake_up");

    vi.advanceTimersByTime(900);
    expect(controller.current?.id).toBe("idle");
  });

  it("wakes up when clicked, without the usual click reaction", () => {
    const { bus, state, renderer } = setup();
    bus.emit("pet.sleep", {});
    bus.emit("pet.clicked", { region: "head" });
    expect(state.get().activity).toBe("awake");
    expect(renderer.played).not.toContain("pet_reaction");
    expect(state.get().stats.affinity).toBe(50);
  });

  it("wakes up to be fed, then eats once awake", () => {
    const { bus, state, renderer, pass } = setup();
    bus.emit("pet.sleep", {});
    bus.emit("pet.fed", {});
    expect(state.get().activity).toBe("awake");
    expect(renderer.last).toBe("wake_up");
    expect(state.get().stats.satiety).toBe(50);
    pass(1_000);
    expect(renderer.last).toBe("eat");
    expect(state.get().stats.satiety).toBe(75);
  });

  it("wakes up for an action from the dock or the action library", () => {
    const { bus, renderer, pass } = setup();
    bus.emit("pet.sleep", {});
    bus.emit("pet.action_requested", { id: "wooden_fish" });
    expect(renderer.last).toBe("wake_up");
    pass(1_000);
    expect(renderer.last).toBe("wooden_fish");
  });

  it("plays a requested action after an already-running wake-up animation", () => {
    const { bus, renderer, pass } = setup();
    bus.emit("pet.sleep", {});
    bus.emit("pet.wake_up", {});
    bus.emit("pet.action_requested", { id: "wooden_fish" });
    expect(renderer.last).toBe("wake_up");
    pass(1_000);
    expect(renderer.last).toBe("wooden_fish");
  });

  it("still wakes up when there is no wake-up animation", () => {
    const { bus, state, controller } = setup({ missing: ["wake_up"] });
    bus.emit("pet.sleep", {});
    bus.emit("pet.wake_up", {});
    expect(state.get().activity).toBe("awake");
    expect(controller.current?.id).toBe("idle");
  });

  it("stays awake when the sleep request is refused", () => {
    const { bus, state } = setup();
    bus.emit("pet.sleep", {});
    bus.emit("pet.wake_up", {});
    // The wake-up animation cannot be interrupted.
    bus.emit("pet.sleep", {});
    expect(state.get().activity).toBe("awake");
  });

  it("ignores repeated sleep and stray wake requests", () => {
    const { bus, renderer } = setup();
    bus.emit("pet.wake_up", {});
    expect(renderer.played).toEqual(["idle"]);
    bus.emit("pet.sleep", {});
    bus.emit("pet.sleep", {});
    expect(renderer.played).toEqual(["idle", "sleep"]);
  });
});

describe("autonomous behavior", () => {
  it("plays an idle action after the scheduled wait, then waits again", () => {
    const { renderer, pass } = setup();
    pass(BEHAVIOR_CONFIG.idleActionIntervalMs.min - 1);
    expect(renderer.played).toEqual(["idle"]);

    pass(1);
    expect(renderer.last).toBe("blink");

    pass(1000);
    expect(renderer.played).toEqual(["idle", "blink", "idle"]);
  });

  it("picks among all actions in the idle category, including newly added ones", () => {
    const { renderer, pass } = setup({
      extraAnimations: [{ id: "dance", file: "a/dance.png", category: "idle", duration: 1000 }],
      random: () => 0.99,
    });
    pass(BEHAVIOR_CONFIG.idleActionIntervalMs.max);
    expect(renderer.last).toBe("dance");
  });

  it("does not play idle actions disabled by the user", () => {
    let enabled = false;
    const { renderer, pass } = setup({ isIdleActionEnabled: () => enabled });
    pass(BEHAVIOR_CONFIG.idleActionIntervalMs.max);
    expect(renderer.played).toEqual(["idle"]);
    enabled = true;
    pass(BEHAVIOR_CONFIG.idleActionIntervalMs.max);
    expect(renderer.last).toBe("blink");
  });

  it("fidgets sooner in a bright mood and later when tired", () => {
    const bright = setup();
    bright.bus.emit("pet.mood", { mood: "bright" });
    bright.pass(BEHAVIOR_CONFIG.idleActionIntervalMs.min);
    bright.pass(BEHAVIOR_CONFIG.idleActionIntervalMs.min * 0.6);
    expect(bright.renderer.played.filter((id) => id === "blink")).toHaveLength(2);

    const tired = setup({ random: () => 0.99 });
    tired.bus.emit("pet.mood", { mood: "tired" });
    tired.pass(BEHAVIOR_CONFIG.idleActionIntervalMs.max);
    tired.pass(BEHAVIOR_CONFIG.idleActionIntervalMs.max);
    expect(tired.renderer.played.filter((id) => id === "blink")).toHaveLength(1);
  });

  it("yawns now and then while tired", () => {
    const { bus, renderer, pass } = setup({ extraAnimations: [{ id: "yawn", file: "a/yawn.png", duration: 1000 }] });
    pass(BEHAVIOR_CONFIG.idleActionIntervalMs.min);
    expect(renderer.last).toBe("blink");
    bus.emit("pet.mood", { mood: "tired" });
    pass(BEHAVIOR_CONFIG.idleActionIntervalMs.max * 2);
    expect(renderer.last).toBe("yawn");
  });

  it("does nothing when the pack has no idle actions", () => {
    const { renderer, pass } = setup({ missing: ["blink"] });
    pass(BEHAVIOR_CONFIG.idleActionIntervalMs.max);
    expect(renderer.played).toEqual(["idle"]);
  });

  it("does not start an idle action over a reaction", () => {
    const { bus, renderer, pass } = setup();
    vi.advanceTimersByTime(BEHAVIOR_CONFIG.idleActionIntervalMs.min - 100);
    bus.emit("pet.fed", {});
    pass(100);
    expect(renderer.last).toBe("eat");
  });

  it("falls asleep after a long time without interaction", () => {
    const { state, renderer, pass } = setup({ missing: ["blink"] });
    pass(BEHAVIOR_CONFIG.sleepAfterIdleMs - 1);
    expect(state.get().activity).toBe("awake");

    pass(1);
    expect(state.get().activity).toBe("sleeping");
    expect(renderer.last).toBe("sleep");
  });

  it("does not fall asleep sooner when energy is low, since the user cannot see it", () => {
    const { state, pass } = setup({ stats: { energy: 10 }, missing: ["blink"] });
    pass(BEHAVIOR_CONFIG.sleepAfterIdleMs - 1);
    expect(state.get().activity).toBe("awake");
  });

  it("stays asleep until the user comes back", () => {
    const { bus, state, renderer, pass } = setup({ missing: ["blink"] });
    pass(BEHAVIOR_CONFIG.sleepAfterIdleMs);
    pass(60 * 60_000);
    expect(renderer.last).toBe("sleep");

    bus.emit("pet.clicked", { region: "body" });
    expect(state.get().activity).toBe("awake");
  });

  it("stops reacting after it is stopped", () => {
    const { bus, renderer, engine } = setup();
    engine.stop();
    bus.emit("pet.clicked", { region: "head" });
    expect(renderer.played).toEqual(["idle"]);
  });
});

describe("focus companion", () => {
  it("leaves the screen edge before starting focus", () => {
    const { bus, controller, docks, focus } = setup();
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "left" });
    expect(controller.current?.id).toBe("peek");
    bus.emit("pet.focus_toggled", {});
    expect(docks).toEqual(["left", null]);
    expect(focus.get().phase).toBe("focusing");
    expect(controller.current?.id).toBe("focus");
  });
  it("starts a round: says so, shows the countdown and settles into the focus pose", () => {
    const { bus, controller, said, badges } = setup();
    bus.emit("pet.focus_toggled", {});
    expect(controller.current?.id).toBe("focus");
    expect(said).toHaveLength(1);
    expect(badges).toEqual(["专注 25:00"]);
  });

  it("returns to the focus pose immediately after dragging", () => {
    const { bus, controller, focus } = setup();
    bus.emit("pet.focus_toggled", {});
    bus.emit("pet.drag_started", {});
    expect(controller.current?.id).toBe("drag");

    bus.emit("pet.drag_ended", { dockSide: null });

    expect(focus.get().phase).toBe("focusing");
    expect(controller.current?.id).toBe("focus");
  });

  it("updates the countdown and neither wanders off nor dozes while focusing", () => {
    const { bus, state, controller, renderer, pass, badges } = setup();
    bus.emit("pet.focus_toggled", {});
    const played = renderer.played.length;
    pass(1000);
    expect(badges[badges.length - 1]).toBe("专注 24:59");
    for (let minute = 0; minute < 24; minute += 1) pass(60_000);
    expect(state.get().activity).toBe("awake");
    expect(controller.current?.id).toBe("focus");
    expect(renderer.played.slice(played)).toEqual([]);
  });

  it("goes back to the focus pose after reacting to a click", () => {
    const { bus, controller, pass } = setup();
    bus.emit("pet.focus_toggled", {});
    bus.emit("pet.petted", {});
    expect(controller.current?.id).toBe("pet_reaction");
    pass(2000);
    pass(1000);
    expect(controller.current?.id).toBe("focus");
  });

  it("celebrates a finished round with a line that stays up, rewards it, then rests before stopping", () => {
    const { bus, state, controller, passSteps, said, badges, focus } = setup();
    const shown: Array<string | null> = [];
    bus.on("pet.alert", ({ heading, text }) => shown.push(heading && text ? `${heading}：${text}` : text));
    bus.emit("pet.focus_toggled", {});
    passSteps(FOCUS_CONFIG.focusMs);
    expect(controller.current?.id).toBe("happy");
    expect(state.get().stats).toMatchObject({ mood: 55, affinity: 52 });
    expect(focus.get().phase).toBe("resting");
    expect(badges[badges.length - 1]).toBe("休息 05:00");
    expect(shown).toEqual(["专注完成！辛苦啦，起来活动一下吧～"]);
    bus.emit("pet.alert_dismissed", {});
    expect(shown).toEqual(["专注完成！辛苦啦，起来活动一下吧～", null]);
    passSteps(FOCUS_CONFIG.restMs);
    expect(focus.get().phase).toBe("off");
    expect(badges[badges.length - 1]).toBeNull();
    expect(state.get().activity).toBe("awake");
    expect(said).toHaveLength(2);
  });

  it("does not count a round the computer slept through, and says so on a line that stays up", () => {
    const { bus, pass, focus } = setup();
    const shown: Array<string | null> = [];
    bus.on("pet.alert", ({ text }) => shown.push(text));
    let completed = 0;
    bus.on("pet.focus_completed", () => completed++);
    bus.emit("pet.focus_toggled", {});
    pass(1_000);
    pass(2 * 60 * 60_000);
    expect(focus.get().phase).toBe("off");
    expect(completed).toBe(0);
    expect(shown[shown.length - 1]).toContain("这轮先不算");
    pass(10 * 60_000);
    expect(shown[shown.length - 1]).toContain("这轮先不算");
    bus.emit("pet.alert_dismissed", {});
    expect(shown[shown.length - 1]).toBeNull();
  });

  it("keeps the round going when the computer slept for a while before its end", () => {
    const { bus, pass, passSteps, focus } = setup();
    let completed = 0;
    bus.on("pet.focus_completed", () => completed++);
    bus.emit("pet.focus_toggled", {});
    pass(1_000);
    pass(5 * 60_000);
    expect(focus.get().phase).toBe("focusing");
    passSteps(FOCUS_CONFIG.focusMs);
    expect(completed).toBe(1);
  });

  it("asks with buttons before stopping a round, and keeps it when the user carries on", () => {
    const { bus, focus, pass } = setup();
    const shown: Array<PetEvents["pet.alert"]> = [];
    bus.on("pet.alert", (alert) => shown.push(alert));
    bus.emit("pet.focus_toggled", {});
    pass(3 * 60_000);
    bus.emit("pet.focus_toggled", {});
    bus.emit("pet.focus_toggled", {});
    expect(focus.get().phase).toBe("focusing");
    expect(shown[shown.length - 1]).toMatchObject({ text: "已经专注 3 分钟了，现在停下，这轮就不算了。", icon: "timer", immediate: true });
    expect(shown[shown.length - 1].choices?.map((choice) => choice.event)).toEqual(["pet.alert_dismissed", "pet.focus_stopped"]);
    bus.emit("pet.alert_dismissed", {});
    expect(shown[shown.length - 1].text).toBeNull();
    expect(focus.get().phase).toBe("focusing");
  });

  it("drops an unanswered question about stopping after a while", () => {
    const { bus, focus, pass } = setup();
    const shown: Array<string | null> = [];
    bus.on("pet.alert", ({ heading, text }) => shown.push(heading && text ? `${heading}：${text}` : text));
    bus.emit("pet.focus_toggled", {});
    bus.emit("pet.focus_toggled", {});
    expect(shown).toEqual(["刚开始专注，要停下吗？"]);
    pass(BEHAVIOR_CONFIG.focusPromptMs);
    expect(shown).toEqual(["刚开始专注，要停下吗？", null]);
    expect(focus.get().phase).toBe("focusing");
  });

  it("asks from the countdown too: stop the round, or start the next one early during the rest", () => {
    const { bus, focus, passSteps } = setup();
    const shown: Array<PetEvents["pet.alert"]> = [];
    bus.on("pet.alert", (alert) => shown.push(alert));
    bus.emit("pet.focus_badge_clicked", {});
    expect(shown).toEqual([]);
    bus.emit("pet.focus_toggled", {});
    passSteps(FOCUS_CONFIG.focusMs);
    bus.emit("pet.alert_dismissed", {});
    bus.emit("pet.focus_badge_clicked", {});
    expect(shown[shown.length - 1]).toMatchObject({ text: "还能休息 5 分钟，要提前开始下一轮吗？" });
    expect(shown[shown.length - 1].choices?.map((choice) => choice.event)).toEqual(["pet.alert_dismissed", "pet.focus_toggled"]);
    bus.emit("pet.focus_toggled", {});
    expect(focus.get().phase).toBe("focusing");
    expect(shown[shown.length - 1].text).toBeNull();
  });

  it("stops a round when the user confirms or when sent to sleep", () => {
    const first = setup();
    first.bus.emit("pet.focus_toggled", {});
    first.bus.emit("pet.focus_toggled", {});
    first.bus.emit("pet.focus_stopped", {});
    expect(first.focus.get().phase).toBe("off");
    expect(first.controller.current?.id).toBe("idle");
    expect(first.badges[first.badges.length - 1]).toBeNull();

    const second = setup();
    second.bus.emit("pet.focus_toggled", {});
    second.bus.emit("pet.sleep", {});
    expect(second.focus.get().phase).toBe("off");
    expect(second.state.get().activity).toBe("sleeping");
  });

  it("stops a round or a rest at once from the menu", () => {
    const { bus, focus, passSteps } = setup();
    bus.emit("pet.focus_toggled", {});
    bus.emit("pet.focus_stopped", {});
    expect(focus.get().phase).toBe("off");
    bus.emit("pet.focus_toggled", {});
    passSteps(FOCUS_CONFIG.focusMs);
    expect(focus.get().phase).toBe("resting");
    bus.emit("pet.focus_stopped", {});
    expect(focus.get().phase).toBe("off");
  });

  it("wakes up to start a round", () => {
    const { bus, focus, state } = setup();
    bus.emit("pet.sleep", {});
    bus.emit("pet.focus_toggled", {});
    expect(state.get().activity).toBe("awake");
    expect(focus.get().phase).toBe("focusing");
  });

  it("starts a new round straight from the rest", () => {
    const { bus, focus, passSteps } = setup();
    bus.emit("pet.focus_toggled", {});
    passSteps(FOCUS_CONFIG.focusMs);
    bus.emit("pet.focus_toggled", {});
    expect(focus.get().phase).toBe("focusing");
  });
});

/** Reminders kept in memory, announced once like the real agenda. `earlier`: open ones from before today. */
function fakeReminders(items: DueReminder[], earlier: DueReminder[] = []): ReminderSource & { reminded: string[]; done: string[]; snoozed: Map<string, number>; moved: string[] } {
  const reminded: string[] = [];
  const done: string[] = [];
  const moved: string[] = [];
  const snoozed = new Map<string, number>();
  const asleep = (id: string, now: number) => (snoozed.get(id) ?? -Infinity) > now;
  return {
    reminded,
    done,
    snoozed,
    moved,
    leftovers: () => earlier.filter((item) => !done.includes(item.id) && !moved.includes(item.id)),
    moveToToday: (ids) => moved.push(...ids),
    due: (now) => items.filter((item) => item.remindAt !== null && item.remindAt <= now && !reminded.includes(item.id) && !done.includes(item.id) && !asleep(item.id, now)),
    markReminded: (ids) => reminded.push(...ids),
    complete: (ids) => done.push(...ids),
    snooze: (ids, until) => ids.forEach((id) => snoozed.set(id, until)),
  };
}

describe("reminders", () => {
  function alerts(bus: EventBus<PetEvents>) {
    const shown: Array<string | null> = [];
    bus.on("pet.alert", ({ heading, text }) => shown.push(heading && text ? `${heading}：${text}` : text));
    return shown;
  }

  it("keeps a due reminder up until the user clicks it away", () => {
    const reminders = fakeReminders([{ id: "r1", text: "开会", remindAt: Date.now() + 5_000 }]);
    const { bus, renderer, pass } = setup({ reminders, extraAnimations: SCENE_ACTIONS });
    const shown = alerts(bus);
    pass(4_000);
    expect(shown).toEqual([]);
    pass(1_000);
    expect(shown).toEqual(["到点啦：开会"]);
    expect(renderer.last).toBe("remind");
    pass(60 * 60_000);
    expect(shown).toEqual(["到点啦：开会"]);
    expect(reminders.reminded).toEqual([]);
    bus.emit("pet.alert_dismissed", {});
    expect(shown).toEqual(["到点啦：开会", null]);
    expect(reminders.reminded).toEqual(["r1"]);
    pass(1_000);
    expect(shown).toHaveLength(2);
  });

  it("plays the reminder action after waking a sleeping pet", () => {
    const reminders = fakeReminders([{ id: "r1", text: "快递", remindAt: Date.now() + 1_000 }]);
    const { bus, controller, pass } = setup({ reminders, extraAnimations: SCENE_ACTIONS });
    bus.emit("pet.sleep", {});
    pass(1_000);
    expect(controller.current?.id).toBe("wake_up");
    pass(1_000);
    expect(controller.current?.id).toBe("remind");
  });

  it("waits for a higher-priority action, then plays the reminder", () => {
    const reminders = fakeReminders([{ id: "r1", text: "快递", remindAt: Date.now() + 1_000 }]);
    const blocker = { id: "busy_pose", file: "a/idle.png", duration: 2400, priority: 45 };
    const { controller, pass } = setup({ reminders, extraAnimations: [...SCENE_ACTIONS, blocker] });
    controller.request(blocker.id);
    pass(1_000);
    expect(controller.current?.id).toBe(blocker.id);
    pass(1_500);
    expect(controller.current?.id).toBe("remind");
  });

  it("calls out after a drag ends at the screen edge", () => {
    const reminders = fakeReminders([{ id: "r1", text: "快递", remindAt: Date.now() + 1_000 }]);
    const { bus, controller, docks, pass } = setup({ reminders, extraAnimations: SCENE_ACTIONS });
    bus.emit("pet.drag_started", {});
    pass(1_000);
    expect(controller.current?.id).toBe("drag");
    bus.emit("pet.drag_ended", { dockSide: "left" });
    pass(0);
    expect(controller.current?.id).toBe("remind");
    expect(docks).toEqual([]);
  });

  it("wakes the pet and brings it out from the screen edge", () => {
    const reminders = fakeReminders([{ id: "r1", text: "喝水", remindAt: Date.now() + 1_000 }]);
    const sleeping = setup({ reminders });
    sleeping.bus.emit("pet.sleep", {});
    sleeping.pass(1_000);
    expect(sleeping.state.get().activity).toBe("awake");

    const docked = setup({ reminders: fakeReminders([{ id: "r2", text: "喝水", remindAt: Date.now() + 1_000 }]) });
    docked.bus.emit("pet.drag_started", {});
    docked.bus.emit("pet.drag_ended", { dockSide: "left" });
    docked.pass(1_000);
    expect(docked.docks).toEqual(["left", null]);
  });

  it("rings the bell even when the pet was busy eating", () => {
    const eating = setup({ reminders: fakeReminders([{ id: "r2", text: "喝水", remindAt: Date.now() + 1_000 }]), extraAnimations: SCENE_ACTIONS });
    eating.controller.request("eat");
    eating.pass(1_000);
    expect(eating.renderer.last).toBe("remind");
  });

  it("gathers reminders on one line and words late ones differently", () => {
    const items: DueReminder[] = [
      { id: "a", text: "开会", remindAt: Date.now() },
      { id: "b", text: "喝水", remindAt: Date.now() + BEHAVIOR_CONFIG.reminderLateMs + 2_000 },
    ];
    const { bus, pass } = setup({ reminders: fakeReminders(items) });
    const shown = alerts(bus);
    pass(0);
    pass(BEHAVIOR_CONFIG.reminderLateMs + 2_000);
    expect(shown).toEqual(["到点啦：开会", "别忘了：开会、喝水"]);
  });

  it("takes a reminder off the line when it is done elsewhere", () => {
    const items: DueReminder[] = [{ id: "a", text: "开会", remindAt: Date.now() }];
    const { bus, pass } = setup({ reminders: fakeReminders(items) });
    const shown = alerts(bus);
    pass(0);
    items.pop();
    pass(1_000);
    expect(shown).toEqual(["到点啦：开会", null]);
  });

  it("waits on the badge during do-not-disturb, then shows the line", () => {
    let quiet = true;
    const reminders = fakeReminders([{ id: "r1", text: "开会", remindAt: Date.now() }]);
    const { bus, badges, pass } = setup({ reminders, holdsReminders: () => quiet });
    const shown = alerts(bus);
    pass(1_000);
    expect(shown).toEqual([]);
    expect(badges[badges.length - 1]).toBe("提醒 1 · 勿扰");
    quiet = false;
    pass(1_000);
    expect(shown).toEqual(["到点啦：开会"]);
    expect(badges[badges.length - 1]).toBeNull();
  });

  it("shows waiting reminders next to the focus countdown", () => {
    const reminders = fakeReminders([{ id: "r1", text: "开会", remindAt: Date.now() }]);
    const { bus, badges, pass } = setup({ reminders, holdsReminders: () => true });
    bus.emit("pet.focus_toggled", {});
    pass(1_000);
    expect(badges[badges.length - 1]).toBe("专注 24:59 · 提醒 1 · 勿扰");
  });

  it("holds new reminders on the badge during a focus round, then shows the line", () => {
    const reminders = fakeReminders([{ id: "r1", text: "开会", remindAt: Date.now() + 5_000 }]);
    const { bus, badges, pass } = setup({ reminders, extraAnimations: SCENE_ACTIONS });
    bus.emit("pet.focus_toggled", {});
    const shown = alerts(bus);
    pass(6_000);
    expect(shown.filter((text) => text !== null)).toEqual([]);
    expect(reminders.reminded).toEqual([]);
    expect(badges[badges.length - 1]).toBe("专注 24:54 · 提醒 1");
    bus.emit("pet.focus_stopped", {});
    pass(1_000);
    expect(shown[shown.length - 1]).toBe("到点啦：开会");
  });

  it("names two reminders at most and counts the rest", () => {
    const items: DueReminder[] = ["开会", "喝水", "交周报"].map((text, index) => ({ id: String(index), text, remindAt: Date.now() }));
    const { bus, pass } = setup({ reminders: fakeReminders(items) });
    const shown: Array<{ text: string | null; more?: boolean }> = [];
    bus.on("pet.alert", (alert) => shown.push(alert));
    pass(0);
    expect(shown).toEqual([{ heading: "别忘了", text: "开会、喝水 等 3 件", more: true }]);
  });

  it("offers to tick off or put off the reminders it names", () => {
    const one = setup({ reminders: fakeReminders([{ id: "r1", text: "开会", remindAt: Date.now() }]) });
    const shown: Array<PetEvents["pet.alert"]> = [];
    one.bus.on("pet.alert", (alert) => shown.push(alert));
    one.pass(0);
    expect(shown[0].choices?.map((choice) => [choice.label, choice.event])).toEqual([["10 分钟后", "pet.reminders_snoozed"], ["完成", "pet.reminders_done"]]);

    const two = setup({ reminders: fakeReminders(["开会", "喝水"].map((text) => ({ id: text, text, remindAt: Date.now() }))) });
    two.bus.on("pet.alert", (alert) => shown.push(alert));
    two.pass(0);
    expect(shown[1].choices?.[1].label).toBe("都完成");
  });

  it("ticks off the reminders on the line when asked", () => {
    const reminders = fakeReminders([{ id: "r1", text: "开会", remindAt: Date.now() }]);
    const { bus, pass } = setup({ reminders });
    const shown = alerts(bus);
    pass(0);
    bus.emit("pet.reminders_done", {});
    expect(reminders.done).toEqual(["r1"]);
    expect(shown).toEqual(["到点啦：开会", null]);
    pass(60 * 60_000);
    expect(shown).toHaveLength(2);
  });

  it("puts the reminders off and brings them up again, worded as late", () => {
    const reminders = fakeReminders([{ id: "r1", text: "开会", remindAt: Date.now() }]);
    const { bus, said, pass } = setup({ reminders });
    const shown = alerts(bus);
    pass(0);
    pass(1_000);
    bus.emit("pet.reminders_snoozed", {});
    expect(reminders.snoozed.get("r1")).toBe(Date.now() + BEHAVIOR_CONFIG.snoozeMs);
    expect(said).toEqual(["好，10 分钟后再叫你"]);
    expect(shown).toEqual(["到点啦：开会", null]);
    pass(BEHAVIOR_CONFIG.snoozeMs);
    expect(shown).toEqual(["到点啦：开会", null, "别忘了：开会"]);
  });

  it("leaves the reminders alone while another line covers them", () => {
    const reminders = fakeReminders([{ id: "r1", text: "开会", remindAt: Date.now() + 1_000 }]);
    const { bus, pass } = setup({ reminders });
    bus.emit("pet.focus_toggled", {});
    pass(1_000);
    bus.emit("pet.focus_badge_clicked", {});
    bus.emit("pet.reminders_done", {});
    expect(reminders.done).toEqual([]);
  });

  it("goes back behind the edge it came from once the line is dismissed", () => {
    const reminders = fakeReminders([{ id: "r1", text: "喝水", remindAt: Date.now() + 1_000 }]);
    const { bus, docks, pass } = setup({ reminders });
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "left" });
    pass(1_000);
    expect(docks).toEqual(["left", null]);
    pass(2_000);
    bus.emit("pet.alert_dismissed", {});
    pass(BEHAVIOR_CONFIG.backToEdgeAfterAlertMs);
    expect(docks).toEqual(["left", null, "left"]);
  });
});

describe("greetings", () => {
  it("wakes the pet, brings it out and says the greeting", () => {
    const { bus, state, docks, said, pass } = setup();
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "right" });
    bus.emit("pet.sleep", {});
    pass(1_000);
    bus.emit("pet.greeting", { text: "早上好！" });
    expect(state.get().activity).toBe("awake");
    expect(docks).toEqual(["right", null]);
    expect(said).toEqual(["早上好！"]);
  });

  it("plays the greeting action after waking a sleeping pet", () => {
    const { bus, controller, pass } = setup({ extraAnimations: SCENE_ACTIONS });
    bus.emit("pet.sleep", {});
    bus.emit("pet.greeting", { text: "早上好！" });
    expect(controller.current?.id).toBe("wake_up");
    pass(1_000);
    expect(controller.current?.id).toBe("wave");
  });

  it("offers to move earlier reminders to today after a morning greeting", () => {
    const reminders = fakeReminders([], [{ id: "r1", text: "交周报", remindAt: 0 }]);
    const { bus, said } = setup({ reminders });
    const shown: Array<string | null> = [];
    bus.on("pet.alert", ({ heading, text, choices }) => shown.push(text === null ? null : `${heading}：${text}｜${choices?.map((choice) => choice.label).join("/")}`));
    bus.emit("pet.greeting", { text: "早上好！", offerMove: true });
    expect(shown).toEqual(["之前没做完：交周报｜不用了/挪到今天"]);
    bus.emit("pet.leftovers_moved", {});
    expect(reminders.moved).toEqual(["r1"]);
    expect(shown[shown.length - 1]).toBeNull();
    expect(said).toEqual(["早上好！", "挪到今天了，到点我再叫你"]);
  });

  it("drops the offer when it is turned down or the reminders are dealt with elsewhere", () => {
    const reminders = fakeReminders([], [{ id: "r1", text: "交周报", remindAt: 0 }, { id: "r2", text: "买菜", remindAt: 0 }]);
    const { bus, pass } = setup({ reminders });
    const shown: Array<string | null> = [];
    bus.on("pet.alert", ({ text }) => shown.push(text));
    bus.emit("pet.greeting", { text: "早上好！", offerMove: true });
    reminders.done.push("r1");
    pass(1_000);
    expect(shown).toEqual(["交周报、买菜", "买菜"]);
    bus.emit("pet.alert_dismissed", {});
    expect(shown[shown.length - 1]).toBeNull();
    bus.emit("pet.leftovers_moved", {});
    expect(reminders.moved).toEqual([]);
  });

  it("makes no offer without the flag or without leftovers", () => {
    const { bus } = setup({ reminders: fakeReminders([], [{ id: "r1", text: "交周报", remindAt: 0 }]) });
    const shown: Array<string | null> = [];
    bus.on("pet.alert", ({ text }) => shown.push(text));
    bus.emit("pet.greeting", { text: "晚上好～" });
    expect(shown).toEqual([]);
    const empty = setup({ reminders: fakeReminders([]) });
    empty.bus.on("pet.alert", ({ text }) => shown.push(text));
    empty.bus.emit("pet.greeting", { text: "早上好！", offerMove: true });
    expect(shown).toEqual([]);
  });

  it("goes back behind the edge after a greeting", () => {
    const { bus, docks, pass } = setup();
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "right" });
    bus.emit("pet.greeting", { text: "早上好！" });
    pass(BEHAVIOR_CONFIG.backToEdgeAfterGreetingMs);
    expect(docks).toEqual(["right", null, "right"]);
  });

  it("reports a finished focus round, but not a stopped one", () => {
    const { bus, passSteps } = setup();
    let completed = 0;
    bus.on("pet.focus_completed", () => completed++);
    bus.emit("pet.focus_toggled", {});
    bus.emit("pet.focus_toggled", {});
    bus.emit("pet.focus_stopped", {});
    bus.emit("pet.focus_toggled", {});
    passSteps(FOCUS_CONFIG.focusMs);
    expect(completed).toBe(1);
  });
});

describe("activities", () => {
  const withScenes = () => setup({ extraAnimations: SCENE_ACTIONS });
  const last = <T,>(list: T[]): T | undefined => list[list.length - 1];
  /** Reports a step of "查收验证码" the way the app does. */
  const mail = (bus: ReturnType<typeof setup>["bus"], update: MailCodeUpdate) => bus.emit("pet.activity", mailCodeActivity(update).activity);
  const agent = (state: ActivityUpdate["state"], extra: Partial<ActivityUpdate> = {}): ActivityUpdate => ({ id: "agent", state, label: "Claude", icon: "timer", ...extra });

  it("shows it is waiting on the badge until the wait ends", () => {
    const { bus, badges } = withScenes();
    mail(bus, { kind: "waiting" });
    expect(last(badges)).toBe("等验证码");
    mail(bus, { kind: "cancelled" });
    expect(last(badges)).toBeNull();
  });

  it("keeps the other badge parts while waiting", () => {
    const { bus, badges } = withScenes();
    bus.emit("pet.focus_toggled", {});
    mail(bus, { kind: "waiting" });
    expect(last(badges)).toMatch(/ · 等验证码$/);
    mail(bus, { kind: "timeout" });
    expect(last(badges)).not.toContain("等验证码");
    expect(last(badges)).not.toBeNull();
  });

  /** The standing line as it goes. */
  const watchAlert = (bus: ReturnType<typeof setup>["bus"]) => {
    const shown: Array<PetEvents["pet.alert"]> = [];
    bus.on("pet.alert", (alert) => shown.push(alert));
    return shown;
  };

  it("comes out from the edge with the code on a line that stays until clicked away, then goes back", () => {
    const { bus, renderer, docks, passSteps, said } = withScenes();
    const shown = watchAlert(bus);
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "right" });
    mail(bus, { kind: "waiting" });
    mail(bus, { kind: "found", code: "384920", sender: "网易邮件中心", copied: true });
    expect(renderer.last).toBe("happy");
    expect(docks).toEqual(["right", null]);
    expect(last(shown)).toEqual({ text: "验证码 384920，已复制（网易邮件中心）", icon: "mail" });
    expect(said).not.toContain("验证码 384920，已复制（网易邮件中心）");
    // The user may have looked away: it stays out with the code.
    passSteps(BEHAVIOR_CONFIG.backToEdgeAfterGreetingMs + 60_000);
    expect(docks).toEqual(["right", null]);
    expect(last(shown)?.text).toBe("验证码 384920，已复制（网易邮件中心）");
    bus.emit("pet.alert_dismissed", {});
    expect(last(shown)?.text).toBeNull();
    passSteps(BEHAVIOR_CONFIG.backToEdgeAfterAlertMs + 1_000);
    expect(last(docks)).toBe("right");
  });

  it("keeps a due reminder ahead of a found code, which waits its turn on the line", () => {
    const reminders = fakeReminders([{ id: "r1", text: "开会", remindAt: Date.now() }]);
    const { bus, pass } = setup({ extraAnimations: SCENE_ACTIONS, reminders });
    const shown = watchAlert(bus);
    pass(0);
    mail(bus, { kind: "found", code: "57743", sender: "Telegram", copied: true });
    expect(last(shown)).toMatchObject({ heading: "到点啦", text: "开会", queued: 1 });
    bus.emit("pet.alert_dismissed", {});
    expect(last(shown)).toMatchObject({ text: "验证码 57743，已复制（Telegram）" });
  });

  it("puts a due reminder ahead of an activity's line, says one more waits, and shows it next", () => {
    const due: DueReminder[] = [];
    const reminders = fakeReminders(due);
    const { bus, pass } = setup({ extraAnimations: SCENE_ACTIONS, reminders });
    const shown = watchAlert(bus);
    bus.emit("pet.activity", agent("waiting", { text: "要运行 pnpm test，等你确认" }));
    expect(last(shown)).toEqual({ text: "要运行 pnpm test，等你确认", icon: "timer" });
    due.push({ id: "r1", text: "点外卖", remindAt: Date.now() });
    pass(0);
    expect(last(shown)).toMatchObject({ heading: "到点啦", text: "点外卖", queued: 1 });
    // Its line is not the one shown: going to it does nothing.
    bus.emit("pet.activity_open_requested", {});
    bus.emit("pet.reminders_done", {});
    expect(reminders.done).toEqual(["r1"]);
    expect(last(shown)).toEqual({ text: "要运行 pnpm test，等你确认", icon: "timer" });
  });

  it("takes down the last answer when a new wait starts", () => {
    const { bus } = withScenes();
    const shown = watchAlert(bus);
    mail(bus, { kind: "timeout" });
    expect(last(shown)?.text).toBe("一直没等到验证码，可以再点一次查收");
    mail(bus, { kind: "waiting" });
    expect(last(shown)?.text).toBeNull();
  });

  it("looks confused and says why when it failed", () => {
    const { bus, renderer } = withScenes();
    const shown = watchAlert(bus);
    mail(bus, { kind: "unrecognized", sender: "GitHub" });
    expect(renderer.last).toBe("confused");
    expect(last(shown)?.text).toContain("没认出码");
    mail(bus, { kind: "failed", message: "连不上 163 邮箱，检查一下网络。" });
    expect(last(shown)?.text).toBe("连不上 163 邮箱，检查一下网络。");
  });

  it("calls the user when an activity waits for them, and keeps its chip after the line is clicked away", () => {
    const { bus, renderer, badges } = withScenes();
    const shown = watchAlert(bus);
    bus.emit("pet.activity", agent("running"));
    expect(shown).toEqual([]);
    bus.emit("pet.activity", agent("waiting", { text: "要运行 pnpm install，等你确认" }));
    expect(renderer.last).toBe("remind");
    expect(last(shown)).toEqual({ text: "要运行 pnpm install，等你确认", icon: "timer" });
    bus.emit("pet.alert_dismissed", {});
    expect(last(shown)?.text).toBeNull();
    expect(last(badges)).toBe("Claude");
  });

  it("sits down to write when an agent sets to work, once, and not for each agent or soon again", () => {
    const { bus, renderer, badges, pass } = withScenes();
    const coding = (id: string, state: ActivityUpdate["state"]): ActivityUpdate => ({ id, state, label: "ai-pet", icon: "agent", noChip: true });
    bus.emit("pet.activity", coding("claude:a", "running"));
    expect(renderer.last).toBe("write");
    // Shown on the coding card, so no chip of its own.
    expect(badges).toEqual([]);
    pass(5_000);
    expect(renderer.last).toBe("idle");
    bus.emit("pet.activity", coding("claude:b", "running"));
    expect(renderer.last).toBe("idle");
    // Both stop and one starts again a moment later: too soon to look up for.
    bus.emit("pet.activity", coding("claude:a", "cancelled"));
    bus.emit("pet.activity", coding("claude:b", "cancelled"));
    bus.emit("pet.activity", coding("claude:a", "running"));
    expect(renderer.last).toBe("idle");
    bus.emit("pet.activity", coding("claude:a", "cancelled"));
    pass(BEHAVIOR_CONFIG.agentWorkGapMs);
    // It dozed off meanwhile, and is not woken for this; once up, the next start counts again.
    bus.emit("pet.activity", coding("claude:a", "running"));
    expect(renderer.last).toBe("sleep");
    bus.emit("pet.activity", coding("claude:a", "cancelled"));
    bus.emit("pet.wake_up", {});
    pass(BEHAVIOR_CONFIG.agentWorkGapMs / 2);
    bus.emit("pet.wake_up", {});
    pass(BEHAVIOR_CONFIG.agentWorkGapMs / 2);
    bus.emit("pet.wake_up", {});
    pass(5_000);
    bus.emit("pet.activity", coding("claude:a", "running"));
    expect(renderer.last).toBe("write");
    // Something else running, such as a wait for a mail code, is not work to sit down for.
    const other = withScenes();
    other.bus.emit("pet.activity", agent("running"));
    expect(other.renderer.last).toBe("idle");
  });

  it("puts a button on an activity's line that names it for its reporter, then puts the line away", () => {
    const { bus } = withScenes();
    const shown = watchAlert(bus);
    const opened: string[] = [];
    bus.on("pet.activity_opened", ({ id }) => opened.push(id));
    bus.emit("pet.activity", agent("waiting", { id: "claude:a", text: "ai-pet 里的 Claude 有话问你", opens: "回到终端" }));
    expect(last(shown)).toMatchObject({ text: "ai-pet 里的 Claude 有话问你", choices: [{ label: "收起", event: "pet.alert_dismissed" }, { label: "回到终端", event: "pet.activity_open_requested" }] });
    bus.emit("pet.activity_open_requested", {});
    expect(opened).toEqual(["claude:a"]);
    expect(last(shown)?.text).toBeNull();
    // Nothing on the line: nothing to open.
    bus.emit("pet.activity_open_requested", {});
    expect(opened).toHaveLength(1);
  });

  it("wakes the pet for an activity that waits for the user or is done", () => {
    for (const state of ["waiting", "done"] as const) {
      const { bus, state: pet } = withScenes();
      bus.emit("pet.sleep", {});
      expect(pet.get().activity).toBe("sleeping");
      bus.emit("pet.activity", agent(state, { text: "看一眼" }));
      expect(pet.get().activity).toBe("awake");
    }
  });

  it("stays behind the edge for news that has no line to show", () => {
    const { bus, docks } = withScenes();
    bus.emit("pet.drag_started", {});
    bus.emit("pet.drag_ended", { dockSide: "left" });
    bus.emit("pet.activity", agent("waiting"));
    bus.emit("pet.activity", agent("done"));
    expect(docks).toEqual(["left"]);
  });

  it("does not call the user again for a report it already has", () => {
    const { bus, renderer, pass } = withScenes();
    const shown = watchAlert(bus);
    bus.emit("pet.activity", agent("waiting", { text: "等你确认" }));
    pass(5_000);
    expect(renderer.last).toBe("idle");
    const alerts = shown.length;
    bus.emit("pet.activity", agent("waiting", { text: "等你确认" }));
    expect(renderer.last).toBe("idle");
    expect(shown).toHaveLength(alerts);
  });

  it("is not held back by a focus round or by do-not-disturb", () => {
    const { bus } = setup({ extraAnimations: SCENE_ACTIONS, holdsReminders: () => true });
    const shown = watchAlert(bus);
    bus.emit("pet.focus_toggled", {});
    bus.emit("pet.activity", agent("waiting", { text: "等你确认" }));
    expect(last(shown)?.text).toBe("等你确认");
  });
});
