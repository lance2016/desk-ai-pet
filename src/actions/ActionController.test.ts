import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../core/EventBus";
import { animationIds, FakeRenderer, makeManifest } from "../testing/fixtures";
import type { PetEvents } from "../types";
import { ActionController } from "./ActionController";
import { ActionRegistry } from "./ActionRegistry";

function setup(missing: string[] = []) {
  const manifest = makeManifest();
  const registry = new ActionRegistry();
  registry.registerManifest(manifest, animationIds(manifest, missing));
  const renderer = new FakeRenderer();
  const bus = new EventBus<PetEvents>();
  const completed: string[] = [];
  bus.on("pet.action.completed", ({ actionId }) => completed.push(actionId));
  const controller = new ActionController({ registry, renderer, bus });
  controller.stop();
  return { controller, renderer, bus, completed };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ActionController", () => {
  it("rests in idle", () => {
    const { controller, renderer } = setup();
    expect(controller.current?.id).toBe("idle");
    expect(renderer.played).toEqual(["idle"]);
  });

  it("plays a requested action and returns to idle when it completes", () => {
    const { controller, renderer, completed } = setup();

    expect(controller.request("happy")).toEqual({ accepted: true, actionId: "happy" });
    expect(renderer.last).toBe("happy");

    vi.advanceTimersByTime(1800);
    expect(completed).toEqual(["happy"]);
    expect(controller.current?.id).toBe("idle");
    expect(renderer.played).toEqual(["idle", "happy", "idle"]);
  });

  it("announces every action it starts", () => {
    const { controller, bus } = setup();
    const started: string[] = [];
    bus.on("pet.action.started", ({ actionId }) => started.push(actionId));

    controller.request("happy");
    vi.advanceTimersByTime(1800);

    expect(started).toEqual(["happy", "idle"]);
  });

  it("does not restart an open-ended action that is already playing", () => {
    const { controller, renderer } = setup();
    expect(controller.request("idle")).toEqual({ accepted: true, actionId: "idle" });
    expect(renderer.played).toEqual(["idle"]);
  });

  it("lets a higher priority action interrupt", () => {
    const { controller, renderer, completed } = setup();
    controller.request("happy");
    expect(controller.request("eat").accepted).toBe(true);
    expect(renderer.last).toBe("eat");

    // The interrupted action must not complete later.
    vi.advanceTimersByTime(2000);
    expect(completed).toEqual([]);
    expect(controller.current?.id).toBe("eat");
  });

  it("rejects a lower priority action while busy", () => {
    const { controller, renderer } = setup();
    controller.request("eat");
    expect(controller.request("blink")).toEqual({ accepted: false, reason: "busy" });
    expect(renderer.last).toBe("eat");
  });

  it("protects a non-interruptible action even from higher priority", () => {
    const { controller } = setup();
    controller.request("sleep");
    controller.request("wake_up");
    expect(controller.request("wake_up")).toEqual({ accepted: false, reason: "busy" });
    expect(controller.current?.id).toBe("wake_up");
  });

  it("enforces the cooldown between two starts", () => {
    const { controller } = setup();
    controller.request("happy");
    vi.advanceTimersByTime(300);
    expect(controller.request("happy")).toEqual({ accepted: false, reason: "cooldown" });

    vi.advanceTimersByTime(200);
    expect(controller.request("happy").accepted).toBe(true);
  });

  it("degrades an unknown action to idle without disturbing the current one", () => {
    const { controller, renderer } = setup();
    expect(controller.request("wave")).toEqual({ accepted: true, actionId: "idle" });

    controller.request("happy");
    expect(controller.request("wave")).toEqual({ accepted: false, reason: "busy" });
    expect(renderer.last).toBe("happy");
  });

  it("plays the fallback of an action whose asset is missing", () => {
    const { controller, renderer } = setup(["eat"]);
    expect(controller.request("eat")).toEqual({ accepted: true, actionId: "happy" });
    expect(renderer.last).toBe("happy");
  });

  it("reports unavailable when nothing can be played", () => {
    const { controller, renderer } = setup(["idle"]);
    expect(controller.request("wave")).toEqual({ accepted: false, reason: "unavailable" });
    expect(renderer.stopped).toBe(1);
  });

  it("stops any action, even a non-interruptible one", () => {
    const { controller, completed } = setup();
    controller.request("sleep");
    controller.request("wake_up");

    controller.stop();

    expect(controller.current?.id).toBe("idle");
    vi.advanceTimersByTime(5000);
    expect(completed).toEqual([]);
  });

  it("keeps a follow-up action started by a completion listener", () => {
    const { controller, bus, renderer } = setup();
    bus.on("pet.action.completed", ({ actionId }) => {
      if (actionId === "happy") controller.request("shy");
    });

    controller.request("happy");
    vi.advanceTimersByTime(1800);

    expect(controller.current?.id).toBe("shy");
    expect(renderer.played).toEqual(["idle", "happy", "shy"]);
  });

  it("cancels the pending completion when disposed", () => {
    const { controller, completed } = setup();
    controller.request("happy");
    controller.dispose();
    vi.advanceTimersByTime(5000);
    expect(completed).toEqual([]);
    expect(controller.current).toBeNull();
  });
});
