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
    saveDisplayPreferences({ controlsLingerMs: 1200 });
    saveOnTop(false);
    expect(loadDisplayPreferences()).toEqual({ controlsLingerMs: 1200 });
    expect(loadOnTop()).toBe(false);
  });

  it("falls back to defaults when stored display preferences are invalid", () => {
    const values = useStorage();
    values.set("ai-pet:display-preferences:v1", JSON.stringify({ controlsLingerMs: -1 }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadDisplayPreferences()).toEqual({ controlsLingerMs: 700 });
    warning.mockRestore();
  });
});
