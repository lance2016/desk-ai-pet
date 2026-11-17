import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stored = new Map<string, string>();
vi.mock("./AppearanceStore", () => ({
  loadAppearance: async (packId: string, id: string) => {
    const image = stored.get(`${packId}/${id}`);
    return image ? { image, frames: 1, fps: 8, motion: "none", motionSpeed: 1, motionStrength: 1, loop: true } : null;
  },
}));

const { characterPictures } = await import("./characterPictures");
const pack = { idle: "/pets/girl-default/idle.png", happy: "/pets/girl-default/happy.png" };
const OWN = "data:image/png;base64,b3du";

describe("characterPictures", () => {
  beforeEach(() => { vi.stubGlobal("indexedDB", {}); });
  afterEach(() => { stored.clear(); vi.unstubAllGlobals(); });

  it("uses a built-in character's own pictures until one is replaced", async () => {
    stored.set("girl-default/happy", OWN);
    expect(await characterPictures("girl-default", pack, ["idle", "happy"])).toEqual({ idle: pack.idle, happy: OWN });
  });

  it("never lends a custom character the pictures of the character it borrows from", async () => {
    stored.set("custom-abc123/idle", OWN);
    expect(await characterPictures("custom-abc123", pack, ["idle", "happy"])).toEqual({ idle: OWN });
  });

  it("leaves out an action the pack does not have", async () => {
    expect(await characterPictures("girl-default", pack, ["idle", "gone"])).toEqual({ idle: pack.idle });
  });
});
