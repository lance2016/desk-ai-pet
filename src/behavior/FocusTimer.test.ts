import { describe, expect, it } from "vitest";
import { FOCUS_CONFIG, FocusTimer, focusBadge, focusProgress, restoreFocus } from "./FocusTimer";

describe("FocusTimer", () => {
  it("runs a focus round, then a rest, then stops", () => {
    const timer = new FocusTimer();
    timer.startFocus(0);
    expect(timer.advance(FOCUS_CONFIG.focusMs - 1)).toBeNull();
    expect(timer.advance(FOCUS_CONFIG.focusMs)).toBe("focus_finished");
    expect(timer.get()).toEqual({ phase: "resting", endsAt: FOCUS_CONFIG.focusMs + FOCUS_CONFIG.restMs });
    expect(timer.advance(FOCUS_CONFIG.focusMs + FOCUS_CONFIG.restMs)).toBe("rest_finished");
    expect(timer.get().phase).toBe("off");
    expect(timer.advance(Number.MAX_SAFE_INTEGER)).toBeNull();
  });

  it("notifies listeners only when the phase changes", () => {
    const timer = new FocusTimer();
    let calls = 0;
    const stop = timer.subscribe(() => { calls += 1; });
    timer.stop();
    timer.startFocus(0);
    timer.advance(10);
    timer.stop();
    stop();
    timer.startFocus(0);
    expect(calls).toBe(2);
  });

  it("carries on after the computer slept, as long as the round has not ended", () => {
    const timer = new FocusTimer();
    timer.startFocus(0);
    expect(timer.advance(1_000)).toBeNull();
    expect(timer.advance(1_000 + 5 * 60_000)).toBeNull();
    expect(timer.get()).toEqual({ phase: "focusing", endsAt: FOCUS_CONFIG.focusMs });
    // Awake again, the ticks come every second up to the end.
    expect(timer.advance(FOCUS_CONFIG.focusMs - 1_000)).toBeNull();
    expect(timer.advance(FOCUS_CONFIG.focusMs)).toBe("focus_finished");
  });

  it("does not count a round whose end the computer slept through", () => {
    const timer = new FocusTimer();
    timer.startFocus(0);
    expect(timer.advance(1_000)).toBeNull();
    expect(timer.advance(FOCUS_CONFIG.focusMs + 60 * 60_000)).toBe("focus_interrupted");
    expect(timer.get().phase).toBe("off");
  });

  it("formats the remaining time for the badge", () => {
    expect(focusBadge({ phase: "off", endsAt: null }, 0)).toBeNull();
    expect(focusBadge({ phase: "focusing", endsAt: FOCUS_CONFIG.focusMs }, 1)).toBe("专注 25:00");
    expect(focusBadge({ phase: "focusing", endsAt: FOCUS_CONFIG.focusMs }, 1000)).toBe("专注 24:59");
    expect(focusBadge({ phase: "resting", endsAt: 5_000 }, 0)).toBe("休息 00:05");
    expect(focusBadge({ phase: "resting", endsAt: 5_000 }, 9_000)).toBe("休息 00:00");
  });

  it("measures how much of the round or the rest has passed", () => {
    expect(focusProgress({ phase: "off", endsAt: null }, 0)).toBeNull();
    expect(focusProgress({ phase: "focusing", endsAt: FOCUS_CONFIG.focusMs }, 0)).toBe(0);
    expect(focusProgress({ phase: "focusing", endsAt: FOCUS_CONFIG.focusMs }, FOCUS_CONFIG.focusMs / 2)).toBe(0.5);
    expect(focusProgress({ phase: "resting", endsAt: FOCUS_CONFIG.restMs }, FOCUS_CONFIG.restMs * 2)).toBe(1);
  });
});

describe("restoreFocus", () => {
  it("keeps a saved round that is still running, and drops one that ended", () => {
    expect(restoreFocus({ phase: "focusing", endsAt: 2_000 }, 1_000)).toEqual({ phase: "focusing", endsAt: 2_000 });
    expect(restoreFocus({ phase: "resting", endsAt: 500 }, 1_000)).toEqual({ phase: "off", endsAt: null });
    expect(restoreFocus(null, 1_000)).toEqual({ phase: "off", endsAt: null });
  });

  it("saves every change", () => {
    const saved: string[] = [];
    const timer = new FocusTimer(undefined, (snapshot) => saved.push(snapshot.phase));
    timer.startFocus(0);
    timer.stop();
    expect(saved).toEqual(["focusing", "off"]);
  });
});
