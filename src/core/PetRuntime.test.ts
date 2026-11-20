import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAssetPack } from "../assets/AssetLoader";
import { createLocalPetStorage } from "../storage/PetStorage";
import { createMemoryStorage, FakeRenderer, MANIFEST_JSON } from "../testing/fixtures";
import type { UserAction } from "../actions/UserActions";
import { PetRuntime } from "./PetRuntime";

function serveManifest(extraAnimations: unknown[] = []) {
  const manifest = { ...MANIFEST_JSON, animations: [...MANIFEST_JSON.animations, ...extraAnimations] };
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(manifest))));
}

async function start(options: { renderer?: FakeRenderer; backing?: Storage; isQuiet?: (now: number) => boolean; userActions?: () => UserAction[]; onActionStarted?: (actionId: string) => void } = {}) {
  const renderer = options.renderer ?? new FakeRenderer();
  const backing = options.backing ?? createMemoryStorage();
  const runtime = await PetRuntime.create({
    renderer,
    storage: createLocalPetStorage(backing, "test-pet"),
    pack: await loadAssetPack("/pets/test-pet"),
    isQuiet: options.isQuiet,
    userActions: options.userActions,
    onActionStarted: options.onActionStarted,
  });
  return { runtime, renderer, backing };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  serveManifest();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PetRuntime", () => {
  it("plays the user's own actions and drops a deleted one while it plays", async () => {
    let actions: UserAction[] = [{ id: "my-spin123", label: "转圈", duration: 1500, createdAt: 0 }];
    const changed = vi.fn();
    const { runtime, renderer } = await start({ userActions: () => actions });
    runtime.bus.on("pet.actions.changed", changed);
    expect(runtime.manifest.animations.some((entry) => entry.id === "my-spin123")).toBe(true);
    expect(runtime.requestAction("my-spin123")).toEqual({ accepted: true, actionId: "my-spin123" });

    actions = [];
    await runtime.refreshAppearance("my-spin123");
    expect(runtime.registry.has("my-spin123")).toBe(false);
    expect(runtime.manifest.animations.some((entry) => entry.id === "my-spin123")).toBe(false);
    expect(renderer.played.slice(-1)[0]).toBe("idle");
    expect(changed).toHaveBeenCalled();
    runtime.destroy();
  });

  it("starts in idle with the actions from the manifest", async () => {
    const { runtime, renderer } = await start();
    expect(renderer.played).toEqual(["idle"]);
    expect(runtime.registry.has("happy")).toBe(true);
    runtime.destroy();
  });

  it("reports actual action starts, including the initial idle action", async () => {
    const onActionStarted = vi.fn();
    const { runtime } = await start({ onActionStarted });
    expect(onActionStarted.mock.calls).toEqual([["idle"]]);

    runtime.requestAction("happy");
    runtime.requestAction("happy");
    expect(onActionStarted.mock.calls).toEqual([["idle"], ["happy"]]);
    runtime.destroy();
  });

  it("refuses to start without an idle animation", async () => {
    await expect(start({ renderer: new FakeRenderer(["idle"]) })).rejects.toThrow(/no usable "idle"/);
  });

  it("plays a newly added action without any code change", async () => {
    serveManifest([{ id: "dance", file: "a/dance.png", duration: 1000 }]);
    const { runtime, renderer } = await start();
    expect(runtime.requestAction("dance")).toEqual({ accepted: true, actionId: "dance" });
    expect(renderer.last).toBe("dance");
    runtime.destroy();
  });

  it("passes speech to the view without touching stats", async () => {
    const { runtime } = await start();
    const said: string[] = [];
    runtime.bus.on("pet.say", ({ text }) => said.push(text));
    const stats = runtime.state.get().stats;
    runtime.say("  早上好  ");
    runtime.say("   ");
    expect(said).toEqual(["早上好"]);
    expect(runtime.state.get().stats).toBe(stats);
    runtime.destroy();
  });

  it("keeps lines the pet starts on its own rare, and silent while quiet", async () => {
    let quiet = true;
    const { runtime } = await start({ isQuiet: () => quiet });
    const said: string[] = [];
    runtime.bus.on("pet.say", ({ text }) => said.push(text));
    expect(runtime.sayProactively("在忙吗？")).toBe(false);
    quiet = false;
    expect(runtime.sayProactively("在忙吗？")).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(runtime.sayProactively("喝点水吧")).toBe(false);
    vi.advanceTimersByTime(20 * 60_000);
    expect(runtime.sayProactively("喝点水吧")).toBe(true);
    expect(said).toEqual(["在忙吗？", "喝点水吧"]);
    runtime.destroy();
  });

  it("shares the quiet check and the gap between greetings and proactive lines", async () => {
    let quiet = true;
    const { runtime } = await start({ isQuiet: () => quiet });
    const greeted: string[] = [];
    runtime.bus.on("pet.greeting", ({ text }) => greeted.push(text));
    expect(runtime.greet("早上好")).toBe(false);
    quiet = false;
    expect(runtime.greet(" 早上好 ")).toBe(true);
    expect(runtime.sayProactively("在忙吗？")).toBe(false);
    expect(greeted).toEqual(["早上好"]);
    runtime.destroy();
  });

  it("tells whether it may speak up without taking the slot", async () => {
    let quiet = true;
    const { runtime } = await start({ isQuiet: () => quiet });
    expect(runtime.maySpeakUp()).toBe(false);
    expect(runtime.maySpeakUp(true)).toBe(true);
    quiet = false;
    expect(runtime.maySpeakUp()).toBe(true);
    expect(runtime.maySpeakUp()).toBe(true);
    expect(runtime.greet("早上好")).toBe(true);
    expect(runtime.maySpeakUp()).toBe(false);
    vi.advanceTimersByTime(20 * 60_000);
    runtime.focus.startFocus(Date.now());
    expect(runtime.maySpeakUp(true)).toBe(false);
    runtime.destroy();
  });

  it("keeps quiet on its own during a focus round, even when quiet time would let a greeting through", async () => {
    const { runtime } = await start();
    runtime.focus.startFocus(Date.now());
    expect(runtime.sayProactively("在忙吗？")).toBe(false);
    expect(runtime.greet("已经很晚啦", true)).toBe(false);
    runtime.focus.stop();
    expect(runtime.sayProactively("在忙吗？")).toBe(true);
    runtime.destroy();
  });

  it("lets outside callers request actions but not state-bound ones", async () => {
    const { runtime, renderer } = await start();
    expect(runtime.requestAction("sleep")).toEqual({ accepted: false, reason: "restricted" });
    expect(runtime.requestAction("wake_up")).toEqual({ accepted: false, reason: "restricted" });
    expect(runtime.state.get().activity).toBe("awake");

    expect(runtime.requestAction("happy").accepted).toBe(true);
    expect(renderer.last).toBe("happy");
    // Requesting an action never changes stats.
    expect(runtime.state.get().stats.mood).toBe(60);
    runtime.destroy();
  });

  it("starts the exact chat action and keeps protected states in charge", async () => {
    const { runtime, renderer } = await start({ renderer: new FakeRenderer(["eat"]) });
    const report = vi.fn();
    runtime.bus.emit("pet.chat_phase", { phase: "thinking" });
    runtime.bus.emit("pet.chat_action_requested", { id: "wooden_fish", report });
    expect(report).toHaveBeenLastCalledWith({ accepted: true, actionId: "wooden_fish" });
    expect(renderer.last).toBe("wooden_fish");
    runtime.bus.emit("pet.chat_phase", { phase: "talking" });
    expect(renderer.last).toBe("wooden_fish");
    expect(runtime.requestAction("eat", "chat")).toEqual({ accepted: false, reason: "unavailable" });
    expect(runtime.requestAction("sleep", "chat")).toEqual({ accepted: false, reason: "unavailable" });
    runtime.focus.startFocus(Date.now());
    expect(runtime.requestAction("happy", "chat")).toEqual({ accepted: false, reason: "busy" });
    runtime.destroy();
  });

  it("mirrors the pet while it hides on the right edge", async () => {
    const { runtime, renderer } = await start();
    runtime.bus.emit("pet.drag_started", {});
    runtime.bus.emit("pet.drag_ended", { dockSide: "right" });
    expect(renderer.last).toBe("peek");
    expect(renderer.mirrored).toBe(true);

    runtime.bus.emit("pet.clicked", { region: "body" });
    expect(renderer.mirrored).toBe(false);
    runtime.destroy();
  });

  it("does not let outside callers hide or carry the pet", async () => {
    const { runtime } = await start();
    expect(runtime.requestAction("peek")).toEqual({ accepted: false, reason: "restricted" });
    expect(runtime.requestAction("drag")).toEqual({ accepted: false, reason: "restricted" });
    runtime.destroy();
  });

  it("degrades an unknown outside request to idle", async () => {
    const { runtime, renderer } = await start();
    expect(runtime.requestAction("moonwalk")).toEqual({ accepted: true, actionId: "idle" });
    expect(renderer.played).toEqual(["idle"]);
    runtime.destroy();
  });

  it("restores stats after a restart", async () => {
    const first = await start();
    first.runtime.bus.emit("pet.fed", {});
    first.runtime.bus.emit("pet.clicked", { region: "head" });
    const statsBeforeQuit = first.runtime.state.get().stats;
    first.runtime.destroy();

    const second = await start({ backing: first.backing });
    expect(second.runtime.state.get().stats).toEqual(statsBeforeQuit);
    expect(statsBeforeQuit.satiety).toBe(95);
    second.runtime.destroy();
  });

  it("drains stats over time and saves them", async () => {
    const { runtime, backing } = await start();
    vi.advanceTimersByTime(3 * 60_000);
    expect(runtime.state.get().stats.satiety).toBeCloseTo(69);
    expect(backing.getItem("ai-pet:character:test-pet:pet")).toContain('"savedAt"');
    runtime.destroy();
  });

  it("acts on its own while left alone", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { runtime, renderer } = await start();
    vi.advanceTimersByTime(7000);
    expect(renderer.played).toContain("blink");
    runtime.destroy();
    vi.restoreAllMocks();
  });

  it("stops everything when destroyed", async () => {
    const { runtime, renderer } = await start();
    runtime.destroy();
    vi.advanceTimersByTime(10 * 60_000);
    expect(renderer.destroyed).toBe(true);
    expect(renderer.played).toEqual(["idle"]);
  });
});
