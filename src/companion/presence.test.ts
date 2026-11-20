import { describe, expect, it } from "vitest";
import { Presence } from "./presence";

const MINUTE = 60_000;
const START = new Date(2026, 10, 17, 10).getTime();

describe("presence", () => {
  it("counts how long the user has been active, and starts over after a real break", () => {
    const presence = new Presence();
    expect(presence.sample(START, 0)).toEqual({ activeMs: 0, returned: false, leftAt: null });
    expect(presence.sample(START + MINUTE, 30).activeMs).toBe(MINUTE);
    // Looking away for a couple of minutes is not a break, but the user is not at the computer right now.
    expect(presence.sample(START + 2 * MINUTE, 120).activeMs).toBeNull();
    expect(presence.sample(START + 3 * MINUTE, 0).activeMs).toBe(3 * MINUTE);
    presence.sample(START + 4 * MINUTE, 300);
    expect(presence.sample(START + 5 * MINUTE, 0).activeMs).toBe(0);
  });

  it("does not guess across missing samples", () => {
    const presence = new Presence();
    presence.sample(START, 0);
    expect(presence.sample(START + 10 * MINUTE, 0).activeMs).toBe(0);
  });

  it("reports a return once, after a long time away", () => {
    const presence = new Presence();
    presence.sample(START, 1800);
    expect(presence.sample(START + MINUTE, 0).returned).toBe(true);
    expect(presence.sample(START + 2 * MINUTE, 0).returned).toBe(false);
  });

  it("says when the user left, on the sample that finds them back", () => {
    const presence = new Presence();
    presence.sample(START, 0);
    // Last touched at one past; still for the half hour after.
    for (let minute = 1; minute <= 31; minute += 1) presence.sample(START + minute * MINUTE, (minute - 1) * 60);
    expect(presence.sample(START + 32 * MINUTE, 0)).toMatchObject({ returned: true, leftAt: START + MINUTE });
    expect(presence.sample(START + 33 * MINUTE, 0).leftAt).toBeNull();
  });

  it("also knows the user was away when the computer slept through it, without calling it a return", () => {
    const presence = new Presence();
    presence.sample(START, 0);
    presence.sample(START + MINUTE, 20);
    const back = presence.sample(START + 50 * MINUTE, 0);
    expect(back).toMatchObject({ returned: false, leftAt: START + MINUTE - 20_000 });
    expect(presence.sample(START + 51 * MINUTE, 0).leftAt).toBeNull();
  });

  it("does not call a short gap being away", () => {
    const presence = new Presence();
    presence.sample(START, 0);
    expect(presence.sample(START + 10 * MINUTE, 0).leftAt).toBeNull();
  });

  it("knows nothing without a reading", () => {
    const presence = new Presence();
    expect(presence.sample(START, null)).toEqual({ activeMs: null, returned: false, leftAt: null });
    expect(presence.sample(START, -1)).toEqual({ activeMs: null, returned: false, leftAt: null });
  });
});
