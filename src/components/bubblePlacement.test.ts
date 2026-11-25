import { describe, expect, it } from "vitest";
import { bubblePlacement } from "./bubblePlacement";

// A 488px window with the pet in its middle.
const PET_X = 244;

describe("bubblePlacement", () => {
  it("leaves a bubble centred on the pet when the whole window is on screen", () => {
    expect(bubblePlacement(200, PET_X, 0, 488)).toEqual({ shift: 0, tail: 100 });
  });

  it("keeps the bubble over the pet when the window hangs off one side but the bubble fits", () => {
    // 100px off the left: the area's middle is 50px right of the pet, so the bubble moves back by that.
    expect(bubblePlacement(200, PET_X, 100, 488)).toEqual({ shift: -50, tail: 100 });
  });

  it("moves a wide bubble only as far as the screen edge needs, and its tail back to the pet", () => {
    // Off the left by 120px: a 300px bubble over the pet would start at 94, past the edge at 128.
    const { shift, tail } = bubblePlacement(300, PET_X, 120, 488);
    expect(shift).toBe(128 - (120 + (368 - 300) / 2));
    expect(tail).toBe(PET_X - 128);
  });

  it("does the same off the right side", () => {
    const { shift, tail } = bubblePlacement(300, PET_X, 0, 368);
    expect(shift).toBe(60 - 34);
    expect(tail).toBe(PET_X - 60);
  });

  it("keeps the tail off the bubble's rounded ends", () => {
    expect(bubblePlacement(60, PET_X, 220, 488).tail).toBe(19);
    expect(bubblePlacement(60, PET_X, 0, 268).tail).toBe(41);
  });
});
