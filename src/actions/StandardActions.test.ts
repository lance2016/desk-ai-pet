import { describe, expect, it } from "vitest";
import girlDefaultPack from "../../public/pets/girl-default/manifest.json";
import sixSixPack from "../../public/pets/six-six/manifest.json";
import { artSource, parsePackManifest, STANDARD_ACTIONS, withStandardActions } from "./StandardActions";

const PACK = { id: "tiny", name: "Tiny", version: "1.0.0", canvas: { width: 100, height: 100 } };
const pack = (animations: unknown[]) => parsePackManifest({ ...PACK, animations });
const byId = (manifest: ReturnType<typeof pack>) => new Map(manifest.animations.map((entry) => [entry.id, entry]));

describe("STANDARD_ACTIONS", () => {
  it("only names fallbacks that are standard actions themselves", () => {
    const ids = new Set(STANDARD_ACTIONS.map((action) => action.id));
    for (const action of STANDARD_ACTIONS) if (action.fallback) expect(ids.has(action.fallback)).toBe(true);
  });

  it("lets look_around face either way, and only it", () => {
    expect(STANDARD_ACTIONS.filter((action) => action.randomFlip).map((action) => action.id)).toEqual(["look_around"]);
  });

  it("keeps the borrower's facing when it wears another action's picture", () => {
    const actions = byId(pack([{ id: "idle", file: "idle.png" }, { id: "blink", file: "blink.png", randomFlip: true }]));
    expect(actions.get("blink")?.randomFlip).toBe(true);
    expect(actions.get("yawn")?.borrowedFrom).toBe("blink");
    expect(actions.get("yawn")?.randomFlip).toBe(false);
  });
});

describe("artSource", () => {
  const fallbacks: Record<string, string> = { remind: "happy", write: "think", a: "b", b: "a" };
  const fallbackOf = (id: string) => fallbacks[id];

  it("is the action itself when it has a picture", () => {
    expect(artSource("remind", (id) => id === "remind", fallbackOf)).toBe("remind");
  });

  it("walks the fallback chain to the first action with a picture", () => {
    expect(artSource("remind", (id) => id === "happy", fallbackOf)).toBe("happy");
  });

  it("ends at idle when nothing on the chain has a picture, even on a loop", () => {
    expect(artSource("write", () => false, fallbackOf)).toBe("idle");
    expect(artSource("a", () => false, fallbackOf)).toBe("idle");
  });
});

describe("withStandardActions", () => {
  it("gives a pack with one picture every standard action, each wearing that picture", () => {
    const actions = byId(pack([{ id: "idle", file: "idle.png" }]));
    expect(actions.size).toBe(STANDARD_ACTIONS.length);
    expect(actions.get("idle")).toMatchObject({ file: "idle.png", loop: true, category: "system", priority: 0 });
    expect(actions.get("idle")?.borrowedFrom).toBeUndefined();
    expect(actions.get("happy")).toMatchObject({ file: "idle.png", borrowedFrom: "idle", motion: "bounce", duration: 1800 });
    expect(actions.get("peek")).toMatchObject({ borrowedFrom: "idle", requiresArt: true });
  });

  it("borrows from the nearest action on the chain that the pack drew", () => {
    const actions = byId(pack([{ id: "idle", file: "idle.png" }, { id: "happy", file: "happy.png" }]));
    expect(actions.get("remind")).toMatchObject({ file: "happy.png", borrowedFrom: "happy" });
    expect(actions.get("pet_reaction")).toMatchObject({ file: "happy.png", borrowedFrom: "happy" });
    expect(actions.get("write")).toMatchObject({ file: "idle.png", borrowedFrom: "idle" });
  });

  it("takes the lender's frames along with its picture", () => {
    const actions = byId(pack([{ id: "idle", file: "idle.png", frames: 4, fps: 8 }]));
    expect(actions.get("think")).toMatchObject({ frames: 4, fps: 8, motion: "tilt" });
  });

  it("lets a pack override a standard action's settings and keep its own extra actions", () => {
    const actions = byId(pack([
      { id: "idle", file: "idle.png" },
      { id: "happy", file: "happy.png", duration: 900 },
      { id: "dance", file: "dance.png", category: "idle" },
    ]));
    expect(actions.get("happy")).toMatchObject({ duration: 900, motion: "bounce", priority: 20 });
    expect(actions.get("dance")).toMatchObject({ file: "dance.png", category: "idle" });
    expect(actions.get("dance")?.tier).toBeUndefined();
  });

  it("lists standard actions most needed first, then the pack's extras", () => {
    const manifest = pack([{ id: "dance", file: "dance.png" }, { id: "happy", file: "happy.png" }, { id: "idle", file: "idle.png" }]);
    const ids = manifest.animations.map((entry) => entry.id);
    expect(ids.slice(0, 5)).toEqual(["idle", "happy", "think", "sleep", "drag"]);
    expect(ids[ids.length - 1]).toBe("dance");
  });

  it("leaves a manifest it cannot read to the manifest check", () => {
    expect(withStandardActions({ animations: "nope" })).toEqual({ animations: "nope" });
    expect(() => parsePackManifest({ ...PACK, animations: [] })).toThrow(/Invalid pet manifest/);
  });
});

describe.each([
  ["six-six", sixSixPack],
  ["girl-default", girlDefaultPack],
])("the built-in character %s", (_id, raw) => {
  const manifest = parsePackManifest(raw);
  const actions = byId(manifest);

  it("has every standard action", () => {
    expect([...actions.keys()].sort()).toEqual(STANDARD_ACTIONS.map((action) => action.id).sort());
  });

  it("draws every standard action itself", () => {
    expect(manifest.animations.filter((entry) => entry.borrowedFrom).map((entry) => entry.id)).toEqual([]);
  });
});
