import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { characterKey, loadActiveCharacter, migrateLegacyCharacterData, saveActiveCharacter, clearCharacterData } from "./CharacterPreferences";

describe("character preferences", () => {
  it("moves pre-character data to the default character once", () => {
    const storage = createMemoryStorage({
      "ai-pet:pet": "stats",
      "ai-pet:chat-history:v1": "history",
      "ai-pet:scale": "1.3",
    });
    migrateLegacyCharacterData(storage);
    expect(storage.getItem(characterKey("girl-default", "pet"))).toBe("stats");
    expect(storage.getItem(characterKey("girl-default", "chat-history:v1"))).toBe("history");
    expect(storage.getItem("ai-pet:pet")).toBeNull();
    expect(storage.getItem("ai-pet:scale")).toBe("1.3");
  });

  it("never overwrites data the default character already has", () => {
    const storage = createMemoryStorage({ "ai-pet:pet": "old", [characterKey("girl-default", "pet")]: "new" });
    migrateLegacyCharacterData(storage);
    expect(storage.getItem(characterKey("girl-default", "pet"))).toBe("new");
    expect(storage.getItem("ai-pet:pet")).toBeNull();
  });

  it("falls back to the default character for missing or invalid ids", () => {
    expect(loadActiveCharacter(createMemoryStorage())).toBe("six-six");
    expect(loadActiveCharacter(createMemoryStorage({ "ai-pet:active-character:v1": "../evil" }))).toBe("six-six");
    const storage = createMemoryStorage();
    saveActiveCharacter("cat", storage);
    expect(loadActiveCharacter(storage)).toBe("cat");
    expect(() => saveActiveCharacter("Bad Id", storage)).toThrow(/Invalid character id/);
  });

  it("clears everything one character saved and nothing else", () => {
    const storage = createMemoryStorage({ [characterKey("cat", "pet")]: "1", [characterKey("cat", "chat-threads:v1")]: "2", [characterKey("cat-2", "pet")]: "3", "ai-pet:active-character:v1": "cat" });
    clearCharacterData("cat", storage);
    expect(storage.length).toBe(2);
    expect(storage.getItem(characterKey("cat-2", "pet"))).toBe("3");
  });
});
