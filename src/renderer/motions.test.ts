import { describe, expect, it } from "vitest";
import { MOTION_PRESETS } from "../types";
import { sampleAdjustedMotion, sampleMotion } from "./motions";

const REST = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

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
