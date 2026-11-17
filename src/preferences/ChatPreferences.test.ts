import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { characterName, DEFAULT_CHAT_PREFERENCES, loadChatPreferences, resetChatPreferences, saveChatPreferences } from "./ChatPreferences";

const PERSONA = { name: "阿橘", personality: "慵懒、爱撒娇的橘猫" };

describe("chat preferences", () => {
  it("stores and restores the user's companion preferences", () => {
    const storage = createMemoryStorage();
    const preferences = { name: "小猫", personality: "安静友好", length: "normal" as const };
    saveChatPreferences("girl", preferences, storage);
    expect(loadChatPreferences("girl", undefined, storage)).toEqual(preferences);
  });
  it("starts from the character persona and keeps each character apart", () => {
    const storage = createMemoryStorage();
    saveChatPreferences("girl", { name: "小猫", personality: "安静友好", length: "normal" }, storage);
    expect(loadChatPreferences("cat", PERSONA, storage)).toEqual({ ...PERSONA, length: "short" });
    expect(loadChatPreferences("cat", undefined, storage)).toEqual(DEFAULT_CHAT_PREFERENCES);
  });
  it("goes back to the persona after a reset", () => {
    const storage = createMemoryStorage();
    saveChatPreferences("cat", { name: "小猫", personality: "", length: "normal" }, storage);
    resetChatPreferences("cat", storage);
    expect(loadChatPreferences("cat", PERSONA, storage).name).toBe("阿橘");
  });
  it("ignores malformed saved preferences without overwriting them", () => {
    const key = "ai-pet:character:girl:chat-preferences:v1";
    const storage = createMemoryStorage({ [key]: "not-json" });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadChatPreferences("girl", undefined, storage)).toEqual(DEFAULT_CHAT_PREFERENCES);
    expect(storage.getItem(key)).toBe("not-json");
    warning.mockRestore();
  });

  it("names a character by the user's choice, or by its own name", () => {
    const storage = createMemoryStorage();
    expect(characterName("girl", "阿橘", storage)).toBe("阿橘");
    saveChatPreferences("girl", { name: "小猫", personality: "", length: "short" }, storage);
    expect(characterName("girl", "阿橘", storage)).toBe("小猫");
  });
});
