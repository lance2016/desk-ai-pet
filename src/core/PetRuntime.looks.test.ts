import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionAppearance } from "../appearance/AppearanceStore";
import { loadAppearance } from "../appearance/AppearanceStore";
import { loadAssetPack } from "../assets/AssetLoader";
import { createLocalPetStorage } from "../storage/PetStorage";
import { createMemoryStorage, FakeRenderer, MANIFEST_JSON } from "../testing/fixtures";
import { PetRuntime } from "./PetRuntime";

vi.mock("../appearance/AppearanceStore", () => ({ loadAppearance: vi.fn() }));

const picture = (name: string): ActionAppearance => ({ image: `data:image/png;base64,${name}`, frames: 1, fps: 12, motion: "breathe", loop: true, motionSpeed: 1, motionStrength: 1 });

/** Starts a character whose user-drawn pictures are `pictures`, keyed by action. */
async function start(packId: string, pictures: Record<string, ActionAppearance>) {
  vi.mocked(loadAppearance).mockImplementation(async (_pack, action) => pictures[action] ?? null);
  const renderer = new FakeRenderer();
  // The fake takes no arguments; the runtime still passes the action and its picture.
  const shown = vi.spyOn(renderer as { setAppearance(id: string, look: ActionAppearance | null): Promise<void> }, "setAppearance");
  const pack = await loadAssetPack("/pets/test-pet");
  const runtime = await PetRuntime.create({
    renderer,
    storage: createLocalPetStorage(createMemoryStorage(), packId),
    pack: { ...pack, manifest: { ...pack.manifest, id: packId } },
  });
  const lookOf = (action: string) => shown.mock.calls.filter((call) => call[0] === action).pop()?.[1];
  return { runtime, renderer, shown, lookOf };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(MANIFEST_JSON))));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(loadAppearance).mockReset();
});

describe("PetRuntime looks", () => {
  it("leaves a built-in character's pictures alone when the user changed none", async () => {
    const { runtime, shown } = await start("test-pet", {});
    expect(shown).not.toHaveBeenCalled();
    runtime.destroy();
  });

  it("shows the user's picture for the action it was drawn for", async () => {
    const happy = picture("happy");
    const { runtime, lookOf } = await start("test-pet", { happy });
    expect(lookOf("happy")).toBe(happy);
    // remind borrows from happy, so it follows the new picture with its own motion.
    expect(lookOf("remind")).toMatchObject({ image: happy.image, motion: "bounce", loop: false });
    expect(lookOf("idle")).toBeUndefined();
    runtime.destroy();
  });

  it("dresses every action of the user's own character in the pictures the user drew", async () => {
    const idle = picture("idle");
    const happy = picture("happy");
    const { runtime, lookOf } = await start("custom-abc123", { idle, happy });
    expect(lookOf("idle")).toBe(idle);
    expect(lookOf("sleep")).toMatchObject({ image: idle.image, loop: true });
    expect(lookOf("think")).toMatchObject({ image: idle.image, motion: "tilt" });
    expect(lookOf("pet_reaction")).toMatchObject({ image: happy.image });
    runtime.destroy();
  });

  it("keeps the borrowed looks of a character the user made until it has its own idle picture", async () => {
    const { runtime, shown } = await start("custom-abc123", { happy: picture("happy") });
    // Only happy and the two actions the pack has no picture for and borrows from it.
    expect(shown.mock.calls.map((call) => call[0]).sort()).toEqual(["happy", "remind", "wave"]);
    runtime.destroy();
  });

  it("does not hide behind the edge without a picture for it, and does once there is one", async () => {
    const pictures: Record<string, ActionAppearance> = { idle: picture("idle") };
    const { runtime, renderer } = await start("custom-abc123", pictures);
    const docked = vi.fn();
    runtime.bus.on("pet.dock_changed", docked);

    runtime.bus.emit("pet.drag_ended", { dockSide: "left" });
    expect(docked).not.toHaveBeenCalled();
    expect(renderer.last).toBe("idle");

    pictures.peek = picture("peek");
    await runtime.refreshAppearance("peek");
    runtime.bus.emit("pet.drag_ended", { dockSide: "left" });
    expect(docked).toHaveBeenCalledWith({ side: "left" });
    expect(renderer.last).toBe("peek");
    runtime.destroy();
  });
});
