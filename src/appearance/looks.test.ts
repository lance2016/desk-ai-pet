import { describe, expect, it } from "vitest";
import { parsePackManifest } from "../actions/StandardActions";
import { borrowedAppearance, hasOwnLook, planLooks } from "./looks";

const PACK = { id: "tiny", name: "Tiny", version: "1.0.0", canvas: { width: 100, height: 100 } };
/** A full pack but for the interactive actions, like the default character before they were drawn. */
const DRAWN = ["idle", "happy", "think", "sleep", "drag", "blink", "look_around", "pet_reaction", "shy", "wake_up", "peek", "focus"];
const actions = parsePackManifest({ ...PACK, animations: DRAWN.map((id) => ({ id, file: `${id}.png` })) }).animations;
const plan = (pictures: string[], ownLook: boolean) => planLooks(actions, new Set(pictures), ownLook);

describe("hasOwnLook", () => {
  it("is true only for a character the user made that has its own idle picture", () => {
    expect(hasOwnLook("custom-abc123", new Set(["idle"]))).toBe(true);
    expect(hasOwnLook("custom-abc123", new Set(["happy"]))).toBe(false);
    expect(hasOwnLook("girl-default", new Set(["idle"]))).toBe(false);
  });
});

describe("planLooks", () => {
  it("shows the pack's pictures, and the pack's borrowed ones, when the user changed nothing", () => {
    const looks = plan([], false);
    expect(looks.get("happy")).toEqual({ source: "happy", playable: true });
    expect(looks.get("remind")).toEqual({ source: "happy", playable: true });
    expect(looks.get("peek")).toEqual({ source: "peek", playable: true });
  });

  it("prefers a picture the user drew for an action on the chain", () => {
    expect(plan(["remind"], false).get("remind")?.source).toBe("remind");
    // write borrows from think; think has the pack's picture, so a user picture for idle changes nothing.
    expect(plan(["idle"], false).get("write")?.source).toBe("think");
  });

  it("makes a character with only its own idle picture wear it for everything", () => {
    const looks = plan(["idle"], true);
    for (const action of actions) expect(looks.get(action.id)?.source).toBe("idle");
    expect(looks.get("happy")?.playable).toBe(true);
  });

  it("switches off an action that needs its own picture until it has one", () => {
    expect(plan(["idle"], true).get("peek")).toEqual({ source: "idle", playable: false });
    expect(plan(["idle", "peek"], true).get("peek")).toEqual({ source: "peek", playable: true });
  });

  it("borrows from the nearest of the user's pictures once the character has its own look", () => {
    const looks = plan(["idle", "happy", "think"], true);
    expect(looks.get("remind")?.source).toBe("happy");
    expect(looks.get("pet_reaction")?.source).toBe("happy");
    expect(looks.get("confused")?.source).toBe("think");
    expect(looks.get("sleep")?.source).toBe("idle");
  });
});

describe("borrowedAppearance", () => {
  it("keeps the borrower's motion and looping on the lender's picture", () => {
    const lender = { image: "data:image/png;base64,AAAA", frames: 2, fps: 6, motion: "breathe" as const, loop: true, motionSpeed: 2, motionStrength: 0.5 };
    expect(borrowedAppearance({ motion: "bounce", loop: false }, lender)).toEqual({
      image: lender.image, frames: 2, fps: 6, layers: [], motion: "bounce", loop: false, motionSpeed: 1, motionStrength: 1,
    });
  });
});
