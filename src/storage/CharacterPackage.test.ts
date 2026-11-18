import { describe, expect, it } from "vitest";
import { createCustomCharacter } from "../assets/PackCatalog";
import { CHARACTER_DATA, characterKey } from "../preferences/CharacterPreferences";
import { createMemoryStorage } from "../testing/fixtures";
import { characterPackageText, createCharacterPackage, parseCharacterPackage, renameCharacterPackage, summarizeCharacterPackage, uniqueCharacterName } from "./CharacterPackage";

const PICTURE = { image: "data:image/png;base64,AAAA", frames: 1, fps: 12, motion: "none" as const, motionSpeed: 1, motionStrength: 1, loop: false };

describe("CharacterPackage", () => {
  it("exports a character that has only some of its settings saved", () => {
    const storage = createMemoryStorage();
    const character = createCustomCharacter({ base: "six-six", name: "阿橘", personality: "慵懒" }, storage, 0, "custom-abcdef");
    storage.setItem(characterKey(character.id, CHARACTER_DATA.chatPreferences), JSON.stringify({ name: "橘子", personality: "慵懒", length: "short" }));
    storage.setItem(characterKey(character.id, CHARACTER_DATA.chatHistory), "[]");
    const pictures = [
      { key: JSON.stringify([character.id, "happy"]), value: PICTURE },
      { key: JSON.stringify(["six-six", "happy"]), value: PICTURE },
    ];

    const characterPackage = createCharacterPackage(character.id, pictures, storage, 5);
    const parsed = parseCharacterPackage(characterPackageText(characterPackage));

    expect(Object.keys(parsed.preferences)).toEqual([CHARACTER_DATA.chatPreferences]);
    expect(parsed.appearances.map((appearance) => appearance.actionId)).toEqual(["happy"]);
    expect(summarizeCharacterPackage(parsed)).toMatchObject({ name: "橘子", actions: 1, customActions: 0 });
  });

  it("numbers a name that another character already uses", () => {
    expect(uniqueCharacterName("阿橘", ["小艾"])).toBe("阿橘");
    expect(uniqueCharacterName("阿橘", ["阿橘"])).toBe("阿橘 2");
    expect(uniqueCharacterName("阿橘", ["阿橘", "阿橘 2"])).toBe("阿橘 3");
    const long = "一".repeat(20);
    expect(uniqueCharacterName(long, [long])).toBe(`${"一".repeat(18)} 2`);
  });

  it("renames both the created name and the name the user changed it to", () => {
    const storage = createMemoryStorage();
    const character = createCustomCharacter({ base: "six-six", name: "阿橘", personality: "慵懒" }, storage, 0, "custom-abcdef");
    storage.setItem(characterKey(character.id, CHARACTER_DATA.chatPreferences), JSON.stringify({ name: "橘子", personality: "慵懒", length: "normal" }));
    const original = createCharacterPackage(character.id, [], storage, 5);

    const renamed = renameCharacterPackage(original, "橘子 2");

    expect(renamed.character.name).toBe("橘子 2");
    expect(JSON.parse(renamed.preferences[CHARACTER_DATA.chatPreferences] ?? "")).toEqual({ name: "橘子 2", personality: "慵懒", length: "normal" });
    expect(original.character.name).toBe("阿橘");
    expect(renameCharacterPackage({ ...original, preferences: {} }, "阿橘 2").preferences).toEqual({});
  });
});
