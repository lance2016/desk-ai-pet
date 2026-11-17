import { describe, expect, it, vi } from "vitest";
import type { PetSnapshot, PetStats } from "../types";
import {
  ADVANCE_STEP_MS,
  applyElapsed,
  applyStatDelta,
  clampStat,
  createSnapshot,
  DEFAULT_STATS,
  deriveEmotion,
  MAX_OFFLINE_MS,
  PetState,
} from "./PetState";

const HOUR_MS = 60 * 60_000;
const stats = (overrides: Partial<PetStats> = {}): PetStats => ({
  satiety: 50,
  energy: 50,
  mood: 50,
  affinity: 50,
  ...overrides,
});
const snapshot = (overrides: Partial<PetSnapshot> = {}): PetSnapshot => ({
  stats: stats(),
  activity: "awake",
  lastInteractionAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe("stat math", () => {
  it("clamps to the 0..100 range", () => {
    expect(clampStat(-5)).toBe(0);
    expect(clampStat(140)).toBe(100);
    expect(clampStat(42)).toBe(42);
  });

  it("applies a delta without touching the original", () => {
    const before = stats({ satiety: 90 });
    const after = applyStatDelta(before, { satiety: 25, mood: -60 });
    expect(after).toEqual(stats({ satiety: 100, mood: 0 }));
    expect(before.satiety).toBe(90);
  });

  it("drains satiety, energy and mood while awake", () => {
    const after = applyElapsed(stats(), HOUR_MS, "awake");
    expect(after.satiety).toBeCloseTo(30);
    expect(after.energy).toBeCloseTo(35);
    expect(after.mood).toBeCloseTo(40);
    expect(after.affinity).toBe(50);
  });

  it("restores energy while sleeping", () => {
    const after = applyElapsed(stats({ energy: 10 }), 10 * 60_000, "sleeping");
    expect(after.energy).toBeCloseTo(30);
    expect(after.mood).toBe(50);
  });

  it("treats negative elapsed time as no time", () => {
    expect(applyElapsed(stats(), -1000, "awake")).toEqual(stats());
  });
});

describe("deriveEmotion", () => {
  it.each([
    [snapshot({ activity: "sleeping" }), "sleepy"],
    [snapshot({ stats: stats({ satiety: 10 }) }), "hungry"],
    [snapshot({ stats: stats({ energy: 10 }) }), "sleepy"],
    [snapshot({ stats: stats({ mood: 80 }) }), "happy"],
    [snapshot({ stats: stats({ mood: 10 }) }), "sad"],
    [snapshot(), "calm"],
  ] as const)("reads %# as %s", (input, expected) => {
    expect(deriveEmotion(input)).toBe(expected);
  });
});

describe("createSnapshot", () => {
  it("starts from the defaults when nothing was saved", () => {
    expect(createSnapshot(1000)).toEqual({
      stats: DEFAULT_STATS,
      activity: "awake",
      lastInteractionAt: 1000,
      updatedAt: 1000,
    });
  });

  it("credits time away as rest", () => {
    const saved = { stats: stats({ energy: 20, satiety: 80 }), savedAt: 0 };
    const restored = createSnapshot(30 * 60_000, saved);
    expect(restored.stats.energy).toBeCloseTo(80);
    expect(restored.stats.satiety).toBeCloseTo(75);
  });

  it("caps the time away", () => {
    const saved = { stats: stats({ satiety: 100 }), savedAt: 0 };
    const afterCap = createSnapshot(MAX_OFFLINE_MS, saved);
    const afterWeek = createSnapshot(7 * 24 * HOUR_MS, saved);
    expect(afterWeek.stats).toEqual(afterCap.stats);
  });
});

describe("PetState", () => {
  it("notifies subscribers with the new snapshot", () => {
    const state = new PetState(snapshot());
    const listener = vi.fn();
    state.subscribe(listener);

    state.changeStats({ mood: 5 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(state.get().stats.mood).toBe(55);
  });

  it("stops notifying after unsubscribing", () => {
    const state = new PetState(snapshot());
    const listener = vi.fn();
    state.subscribe(listener)();

    state.changeStats({ mood: 5 });

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not notify when the activity is unchanged", () => {
    const state = new PetState(snapshot());
    const listener = vi.fn();
    state.subscribe(listener);

    state.setActivity("awake");
    expect(listener).not.toHaveBeenCalled();

    state.setActivity("sleeping");
    expect(state.get().activity).toBe("sleeping");
  });

  it("records the interaction time", () => {
    const state = new PetState(snapshot());
    state.markInteraction(1234);
    expect(state.get().lastInteractionAt).toBe(1234);
  });

  it("advances stats only after a full step has passed", () => {
    const state = new PetState(snapshot());
    const listener = vi.fn();
    state.subscribe(listener);

    state.advance(ADVANCE_STEP_MS - 1);
    expect(listener).not.toHaveBeenCalled();

    state.advance(3 * ADVANCE_STEP_MS);
    expect(state.get().stats.satiety).toBeCloseTo(49);
    expect(state.get().updatedAt).toBe(3 * ADVANCE_STEP_MS);
  });

  it("counts a long gap, such as the computer sleeping, no longer than time away", () => {
    const state = new PetState(snapshot());
    state.advance(10 * MAX_OFFLINE_MS);
    const capped = new PetState(snapshot());
    capped.advance(MAX_OFFLINE_MS);
    expect(state.get().stats).toEqual(capped.get().stats);
  });
});
