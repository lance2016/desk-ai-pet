import { describe, expect, it } from "vitest";
import { loadFactLearning } from "../facts/FactStore";
import { createMemoryStorage } from "../testing/fixtures";
import { loadSkillsOff, saveSkillOn } from "./SkillPreferences";

describe("skill preferences", () => {
  it("leaves every skill on by default", () => {
    expect(loadSkillsOff(createMemoryStorage())).toEqual([]);
  });

  it("turns a skill off and on again", () => {
    const storage = createMemoryStorage();
    saveSkillOn("quiet", false, storage);
    saveSkillOn("actions", false, storage);
    expect(loadSkillsOff(storage)).toEqual(["quiet", "actions"]);
    saveSkillOn("quiet", true, storage);
    expect(loadSkillsOff(storage)).toEqual(["actions"]);
  });

  it("keeps remembering in the same switch as the memory page", () => {
    const storage = createMemoryStorage();
    saveSkillOn("remember", false, storage);
    expect(loadFactLearning(storage)).toBe(false);
    expect(loadSkillsOff(storage)).toEqual(["remember"]);
    saveSkillOn("remember", true, storage);
    expect(loadFactLearning(storage)).toBe(true);
    expect(loadSkillsOff(storage)).toEqual([]);
  });

  it("ignores a stored list it cannot read", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:skills-off:v1", "[\"nope\"]");
    expect(loadSkillsOff(storage)).toEqual([]);
  });
});
