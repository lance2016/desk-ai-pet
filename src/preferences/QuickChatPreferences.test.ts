import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUICK_CHAT_SHORTCUT, loadQuickChatShortcut, quickChatShortcutLabel, recordShortcut, saveQuickChatShortcut } from "./QuickChatPreferences";

function useStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  return values;
}

const press = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) =>
  ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

afterEach(() => vi.unstubAllGlobals());

describe("quick chat shortcut storage", () => {
  it("defaults to Command-Shift-Space", () => {
    useStorage();
    expect(DEFAULT_QUICK_CHAT_SHORTCUT).toBe("Shift+Super+Space");
    expect(loadQuickChatShortcut()).toBe(DEFAULT_QUICK_CHAT_SHORTCUT);
  });

  it("remembers a recorded shortcut or turning it off", () => {
    useStorage();
    saveQuickChatShortcut("Control+Alt+KeyK");
    expect(loadQuickChatShortcut()).toBe("Control+Alt+KeyK");
    saveQuickChatShortcut(null);
    expect(loadQuickChatShortcut()).toBeNull();
  });

  it("drops a saved Option-only shortcut, which macOS no longer delivers", () => {
    const values = useStorage();
    values.set("ai-pet:quick-chat-shortcut:v1", JSON.stringify("Alt+Space"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadQuickChatShortcut()).toBe(DEFAULT_QUICK_CHAT_SHORTCUT);
    expect(() => saveQuickChatShortcut("Alt+Space")).toThrow();
    warning.mockRestore();
  });
});

describe("recordShortcut", () => {
  it("turns a key press into an accelerator with modifiers in a fixed order", () => {
    expect(recordShortcut(press("KeyK", { metaKey: true, ctrlKey: true }))).toEqual({ ok: true, shortcut: "Control+Super+KeyK" });
    expect(recordShortcut(press("Space", { shiftKey: true, metaKey: true }))).toEqual({ ok: true, shortcut: "Shift+Super+Space" });
  });

  it("refuses combinations the system or most apps already use", () => {
    expect(recordShortcut(press("KeyC", { metaKey: true }))).toEqual({ ok: false, reason: "reserved" });
    expect(recordShortcut(press("Space", { metaKey: true }))).toEqual({ ok: false, reason: "reserved" });
    expect(recordShortcut(press("Tab", { metaKey: true }))).toEqual({ ok: false, reason: "reserved" });
  });

  it("waits while only modifier keys are down", () => {
    expect(recordShortcut(press("MetaLeft", { metaKey: true }))).toEqual({ ok: false, reason: "waiting" });
  });

  it("asks for Control or Command", () => {
    expect(recordShortcut(press("Space", { altKey: true }))).toEqual({ ok: false, reason: "needs-modifier" });
    expect(recordShortcut(press("Space", { altKey: true, shiftKey: true }))).toEqual({ ok: false, reason: "needs-modifier" });
    expect(recordShortcut(press("KeyK"))).toEqual({ ok: false, reason: "needs-modifier" });
  });

  it("refuses keys the native side cannot register", () => {
    expect(recordShortcut(press("Fn", { metaKey: true }))).toEqual({ ok: false, reason: "unsupported-key" });
  });
});

describe("quickChatShortcutLabel", () => {
  it("uses Mac key symbols", () => {
    expect(quickChatShortcutLabel("Shift+Super+Space")).toBe("⇧⌘ Space");
    expect(quickChatShortcutLabel("Control+Alt+KeyK")).toBe("⌃⌥ K");
    expect(quickChatShortcutLabel("Control+Digit1")).toBe("⌃ 1");
    expect(quickChatShortcutLabel("Super+ArrowUp")).toBe("⌘ ↑");
  });
});
