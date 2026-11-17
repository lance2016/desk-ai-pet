import { describe, expect, it } from "vitest";
import { isLayerVisible, layerElapsedSeconds, layerMotionProgress } from "./layerTiming";

describe("layer frame timing", () => {
  it("shows layers throughout the action when no range is set", () => {
    expect([0, 1, 2, 3].map((frame) => isLayerVisible({}, frame, 4))).toEqual([true, true, true, true]);
  });
  it("uses an inclusive one-based range", () => {
    expect([0, 1, 2, 3].map((frame) => isLayerVisible({ startFrame: 2, endFrame: 3 }, frame, 4))).toEqual([false, true, true, false]);
  });

  it("starts timed overlays at their first visible frame and restarts each loop", () => {
    expect(layerElapsedSeconds({ startFrame: 2 }, 0.25, 4, 8, true)).toBeCloseTo(0.125);
    expect(layerElapsedSeconds({ startFrame: 2 }, 0.75, 4, 8, true)).toBeCloseTo(0.125);
    expect(layerElapsedSeconds({}, 0.75, 4, 8, true)).toBeCloseTo(0.75);
  });

  it("spreads a timed effect over the visible frames and preserves legacy progress", () => {
    expect(layerMotionProgress({ startFrame: 2, endFrame: 3 }, 0.125, 4, 8, 0.9)).toBeCloseTo(0.5);
    expect(layerMotionProgress({}, 0.125, 4, 8, 0.9)).toBe(0.9);
  });
});
