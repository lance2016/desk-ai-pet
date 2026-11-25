import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { loadFocusPreferences, saveFocusPreferences } from "./FocusPreferences";

describe("FocusPreferences", () => {
  it("starts at 25 minutes", () => {
    expect(loadFocusPreferences(createMemoryStorage())).toEqual({ minutes: 25 });
  });

  it("keeps the length the user chose", () => {
    const storage = createMemoryStorage();
    saveFocusPreferences({ minutes: 50 }, storage);
    expect(loadFocusPreferences(storage)).toEqual({ minutes: 50 });
  });

  it("falls back to 25 minutes on a length it does not offer", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:focus-preferences:v1", JSON.stringify({ minutes: 40 }));
    expect(loadFocusPreferences(storage)).toEqual({ minutes: 25 });
  });
});
