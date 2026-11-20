import { describe, expect, it } from "vitest";
import { MOTION_PRESETS } from "../types";
import { BREATHE_SECONDS, calmMotion, sampleAdjustedMotion, sampleMotion } from "./motions";

const REST = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1 };

describe("sampleMotion", () => {
  it("keeps the pet still for the 'none' motion", () => {
    expect(sampleMotion("none", 3, 0.5)).toEqual(REST);
  });

  it.each(MOTION_PRESETS)("starts '%s' from the rest pose", (preset) => {
    const start = sampleMotion(preset, 0, 0);
    for (const key of Object.keys(REST) as Array<keyof typeof REST>) {
      expect(start[key]).toBeCloseTo(REST[key], 1);
    }
  });

  it.each(["squash", "wiggle", "pop", "tilt"] as const)("ends '%s' back at the rest pose", (preset) => {
    const end = sampleMotion(preset, 1, 1);
    for (const key of Object.keys(REST) as Array<keyof typeof REST>) {
      expect(end[key]).toBeCloseTo(REST[key], 5);
    }
  });

  it("breathes in for the first quarter of a breath and out at three quarters, as the focus pool follows it", () => {
    expect(sampleMotion("breathe", BREATHE_SECONDS / 4, 0).scaleY).toBeCloseTo(1.012);
    expect(sampleMotion("breathe", (BREATHE_SECONDS * 3) / 4, 0).scaleY).toBeCloseTo(0.988);
  });

  it("raises and fades a timed floating label", () => {
    const middle = sampleMotion("float", 0.25, 0.5);
    expect(middle.y).toBeCloseTo(-22.5);
    expect(middle.alpha).toBeCloseTo(0.5);
    expect(sampleMotion("float", 0.5, 1).alpha).toBe(0);
  });

  it("lifts the pet off the ground while bouncing", () => {
    expect(sampleMotion("bounce", 0.2, 0).y).toBeLessThan(0);
  });
});

describe("custom motion settings", () => {
  it("keeps the pet still when the intensity is zero", () => {
    const pose = sampleAdjustedMotion("bounce", 0.2, 0.4, 1, 0);
    for (const key of Object.keys(REST) as Array<keyof typeof REST>) {
      expect(pose[key]).toBeCloseTo(REST[key]);
    }
  });

  it("changes the motion speed and scales its intensity", () => {
    const reference = sampleMotion("sway", 0.4, 0);
    const adjusted = sampleAdjustedMotion("sway", 0.2, 0, 2, 0.5);
    expect(adjusted.rotation).toBeCloseTo(reference.rotation * 0.5);
  });
});

describe("calmMotion", () => {
  it("keeps the pet in place when Reduce Motion is on", () => {
    expect(calmMotion("bounce", true)).toBe("none");
    expect(calmMotion("wiggle", true)).toBe("none");
    expect(calmMotion("sway", true)).toBe("none");
  });

  it("keeps the gentle motions and leaves everything alone otherwise", () => {
    expect(calmMotion("breathe", true)).toBe("breathe");
    expect(calmMotion("squash", true)).toBe("squash");
    expect(calmMotion("bounce", false)).toBe("bounce");
  });
});
