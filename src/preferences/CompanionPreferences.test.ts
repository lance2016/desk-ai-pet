import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { DEFAULT_COMPANION, loadCompanionPreferences, saveCompanionPreferences } from "./CompanionPreferences";

describe("companion preferences", () => {
  it("turns on what a newer version added for settings saved before it", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:companion-preferences:v1", JSON.stringify({ night: false, rest: true, welcomeBack: true, nightTime: "23:30", restMinutes: 60 }));
    expect(loadCompanionPreferences(storage)).toEqual({ ...DEFAULT_COMPANION, night: false, restMinutes: 60 });
  });

  it("keeps the switches the user turned off", () => {
    const storage = createMemoryStorage();
    saveCompanionPreferences({ ...DEFAULT_COMPANION, headsUp: false, followUp: false, careByModel: false }, storage);
    expect(loadCompanionPreferences(storage)).toMatchObject({ headsUp: false, followUp: false, careByModel: false });
  });

  it("falls back to the defaults for unreadable settings", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:companion-preferences:v1", "{");
    expect(loadCompanionPreferences(storage)).toEqual(DEFAULT_COMPANION);
  });
});
