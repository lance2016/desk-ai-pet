import { describe, expect, it } from "vitest";
import { animationIds, makeManifest } from "../testing/fixtures";
import { ActionRegistry } from "./ActionRegistry";

function registryFor(extraAnimations: unknown[] = [], missing: string[] = []): ActionRegistry {
  const manifest = makeManifest(extraAnimations);
  const registry = new ActionRegistry();
  registry.registerManifest(manifest, animationIds(manifest, missing));
  return registry;
}

describe("ActionRegistry", () => {
  it("registers every manifest animation as an action", () => {
    const registry = registryFor();
    expect(registry.has("idle")).toBe(true);
    expect(registry.get("eat")).toEqual({
      id: "eat",
      category: "reaction",
      animation: "eat",
      priority: 30,
      loop: false,
      interruptible: true,
      duration: 2400,
      cooldown: 3000,
      fallback: "happy",
    });
  });

  it("registers a new action from a manifest entry alone", () => {
    const registry = registryFor([{ id: "dance", file: "a/dance.png", category: "idle" }]);
    expect(registry.get("dance")).toMatchObject({ id: "dance", animation: "dance", category: "idle" });
    expect(registry.list().map((action) => action.id)).toContain("dance");
  });

  it("leaves a looping action open-ended", () => {
    expect(registryFor().get("idle")?.duration).toBeUndefined();
  });

  it("derives the duration of a one-shot action from its frames", () => {
    const registry = registryFor([
      { id: "wave", file: "a/wave.png", frames: 6, fps: 12 },
      { id: "nod", file: "a/nod.png" },
    ]);
    expect(registry.get("wave")?.duration).toBe(500);
    expect(registry.get("nod")?.duration).toBe(1500);
  });

  it("does not register an action whose asset is missing", () => {
    const registry = registryFor([], ["eat"]);
    expect(registry.has("eat")).toBe(false);
  });

  it("resolves a missing action to its fallback", () => {
    expect(registryFor([], ["eat"]).resolve("eat")?.id).toBe("happy");
  });

  it("follows a chain of fallbacks", () => {
    const registry = registryFor([{ id: "feast", file: "a/feast.png", fallback: "eat" }], ["feast", "eat"]);
    expect(registry.resolve("feast")?.id).toBe("happy");
  });

  it("resolves to idle when there is no usable fallback", () => {
    const registry = registryFor(
      [
        { id: "a", file: "a/a.png", fallback: "b" },
        { id: "b", file: "a/b.png", fallback: "a" },
      ],
      ["a", "b", "shy"],
    );
    expect(registry.resolve("a")?.id).toBe("idle");
    expect(registry.resolve("shy")?.id).toBe("idle");
    expect(registry.resolve("never-declared")?.id).toBe("idle");
  });

  it("resolves to nothing when even idle is missing", () => {
    expect(registryFor([], ["idle"]).resolve("wave")).toBeUndefined();
  });

  it("forgets the missing state once the action is registered", () => {
    const registry = registryFor([], ["eat"]);
    registry.register({ id: "eat", category: "reaction", animation: "eat", priority: 30, loop: false, interruptible: true });
    expect(registry.resolve("eat")?.id).toBe("eat");
  });
});
