import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDisplayPreferences, loadOnTop, saveDisplayPreferences, saveOnTop } from "./DisplayPreferences";

function useStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  return values;
}

afterEach(() => vi.unstubAllGlobals());

describe("display preferences", () => {
  it("persists valid settings and restores the on-top choice", () => {
    useStorage();
    saveDisplayPreferences({ controlsLingerMs: 1200, chatLauncher: "head", copyHint: false });
    saveOnTop(false);
    expect(loadDisplayPreferences()).toEqual({ controlsLingerMs: 1200, chatLauncher: "head", copyHint: false });
    expect(loadOnTop()).toBe(false);
  });

  it("falls back to defaults when stored display preferences are invalid", () => {
    const values = useStorage();
    values.set("ai-pet:display-preferences:v1", JSON.stringify({ controlsLingerMs: -1 }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadDisplayPreferences()).toEqual({ controlsLingerMs: 700, chatLauncher: "corner", copyHint: true });
    warning.mockRestore();
  });

  it("gives settings saved before the chat button its defaults", () => {
    const values = useStorage();
    values.set("ai-pet:display-preferences:v1", JSON.stringify({ controlsLingerMs: 400 }));
    expect(loadDisplayPreferences()).toEqual({ controlsLingerMs: 400, chatLauncher: "corner", copyHint: true });
  });
});
