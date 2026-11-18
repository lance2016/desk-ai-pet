import { describe, expect, it } from "vitest";
import { DEFAULT_TRANSLATION_SHORTCUT, loadTranslationShortcut, saveTranslationShortcut } from "./TranslationShortcut";

import { createMemoryStorage } from "../testing/fixtures";
describe("translation shortcut", () => {
  it("uses the default until the user changes or disables it", () => {
    const storage = createMemoryStorage();
    expect(loadTranslationShortcut(storage)).toBe(DEFAULT_TRANSLATION_SHORTCUT);
    saveTranslationShortcut("Control+Shift+KeyY", storage);
    expect(loadTranslationShortcut(storage)).toBe("Control+Shift+KeyY");
    saveTranslationShortcut(null, storage);
    expect(loadTranslationShortcut(storage)).toBeNull();
  });
  it("rejects reserved or malformed saved shortcuts", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:translation-shortcut:v1", JSON.stringify("Super+KeyC"));
    expect(loadTranslationShortcut(storage)).toBe(DEFAULT_TRANSLATION_SHORTCUT);
  });
});
