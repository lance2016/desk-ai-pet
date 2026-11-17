import { describe, expect, it } from "vitest";
import { ART_PROMPT_MAX_CHARS, DEFAULT_ART_PROMPTS } from "../assets/ArtPrompt";
import { createMemoryStorage } from "../testing/fixtures";
import { loadArtPrompts, saveArtPrompts } from "./ArtPromptPreferences";
import { CHARACTER_DATA, characterKey } from "./CharacterPreferences";

const key = (packId: string) => characterKey(packId, CHARACTER_DATA.artPrompts);

describe("art prompt preferences", () => {
  it("starts from the default prompts", () => {
    expect(loadArtPrompts("custom-a", createMemoryStorage())).toEqual(DEFAULT_ART_PROMPTS);
  });

  it("keeps a changed prompt for the character it was changed on", () => {
    const storage = createMemoryStorage();
    saveArtPrompts("custom-a", { ...DEFAULT_ART_PROMPTS, first: "像素风的正面图：{动作}" }, storage);

    expect(loadArtPrompts("custom-a", storage)).toEqual({ first: "像素风的正面图：{动作}", action: DEFAULT_ART_PROMPTS.action });
    expect(loadArtPrompts("custom-b", storage)).toEqual(DEFAULT_ART_PROMPTS);
  });

  it("stores only what differs from the defaults", () => {
    const storage = createMemoryStorage();
    saveArtPrompts("custom-a", { ...DEFAULT_ART_PROMPTS, action: "我的模板 {动作}" }, storage);

    expect(JSON.parse(storage.getItem(key("custom-a")) ?? "")).toEqual({ action: "我的模板 {动作}" });
  });

  it("goes back to the default when a prompt is cleared", () => {
    const storage = createMemoryStorage();
    saveArtPrompts("custom-a", { first: "自己写的", action: "自己写的" }, storage);
    saveArtPrompts("custom-a", { first: "", action: "自己写的" }, storage);

    expect(loadArtPrompts("custom-a", storage).first).toBe(DEFAULT_ART_PROMPTS.first);
  });

  it("refuses a prompt that is too long", () => {
    expect(() => saveArtPrompts("custom-a", { ...DEFAULT_ART_PROMPTS, action: "长".repeat(ART_PROMPT_MAX_CHARS + 1) }, createMemoryStorage())).toThrow();
  });

  it("ignores saved data it cannot read", () => {
    expect(loadArtPrompts("custom-a", createMemoryStorage({ [key("custom-a")]: "{broken" }))).toEqual(DEFAULT_ART_PROMPTS);
    expect(loadArtPrompts("custom-a", createMemoryStorage({ [key("custom-a")]: JSON.stringify({ first: 3 }) }))).toEqual(DEFAULT_ART_PROMPTS);
  });
});
