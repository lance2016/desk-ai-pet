import { describe, expect, it } from "vitest";
import { isCloseShortcut } from "./keyboard";

const press = (key: string, mods: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">> = {}) =>
  ({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods }) as KeyboardEvent;

describe("isCloseShortcut", () => {
  it("takes ⌘W, whatever the case of the letter", () => {
    expect(isCloseShortcut(press("w", { metaKey: true }))).toBe(true);
    expect(isCloseShortcut(press("W", { metaKey: true }))).toBe(true);
  });

  it("leaves W alone, and ⌘W with another modifier", () => {
    expect(isCloseShortcut(press("w"))).toBe(false);
    expect(isCloseShortcut(press("w", { ctrlKey: true }))).toBe(false);
    expect(isCloseShortcut(press("w", { metaKey: true, shiftKey: true }))).toBe(false);
    expect(isCloseShortcut(press("w", { metaKey: true, altKey: true }))).toBe(false);
    expect(isCloseShortcut(press("q", { metaKey: true }))).toBe(false);
  });
});
