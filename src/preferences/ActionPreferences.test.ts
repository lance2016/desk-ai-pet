import { describe, expect, it } from "vitest";
import { makeManifest } from "../testing/fixtures";
import { canShortcut } from "./ActionPreferences";

describe("manual actions", () => {
  it("limits manual shortcuts to finite non-system actions", () => {
    const actions = makeManifest([{ id: "forever", file: "a.png", loop: true }]).animations;
    expect(canShortcut(actions.find((item) => item.id === "happy")!)).toBe(true);
    expect(canShortcut(actions.find((item) => item.id === "sleep")!)).toBe(false);
    expect(canShortcut(actions.find((item) => item.id === "forever")!)).toBe(false);
  });
});
