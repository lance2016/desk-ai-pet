import { describe, expect, it, vi } from "vitest";
import { loadFactLearning } from "../facts/FactStore";
import { createMemoryStorage } from "../testing/fixtures";
import { loadSkillsOff, loadSwitchedOff, loadToolsOff, saveSkillOn, saveToolOn } from "./SkillPreferences";

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

  it("reads switches saved before reminders, notes and the daily report were split", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:skills-off:v1", JSON.stringify(["memory", "quiet"]));
    expect(loadSkillsOff(storage)).toEqual(["reminders", "notes", "quiet"]);
    storage.setItem("ai-pet:skills-off:v1", JSON.stringify(["lookup", "memory"]));
    expect(loadSkillsOff(storage)).toEqual(["reminders", "notes", "review"]);
    saveSkillOn("notes", true, storage);
    expect(storage.getItem("ai-pet:skills-off:v1")).toBe(JSON.stringify(["reminders", "review"]));
  });

  it("turns single tools off and on, apart from the skills", () => {
    const storage = createMemoryStorage();
    expect(loadSwitchedOff(storage)).toEqual({ skills: [], tools: [] });
    saveToolOn("delete_reminder", false, storage);
    saveToolOn("delete_note", false, storage);
    saveSkillOn("quiet", false, storage);
    expect(loadSwitchedOff(storage)).toEqual({ skills: ["quiet"], tools: ["delete_reminder", "delete_note"] });
    saveToolOn("delete_reminder", true, storage);
    saveToolOn("delete_note", true, storage);
    expect(loadToolsOff(storage)).toEqual([]);
    expect(storage.getItem("ai-pet:tools-off:v1")).toBeNull();
  });

  it("ignores a stored tool list it cannot read", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:tools-off:v1", "[\"Not A Tool\"]");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadToolsOff(storage)).toEqual([]);
  });

  it("ignores a stored list it cannot read", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:skills-off:v1", "[\"nope\"]");
    expect(loadSkillsOff(storage)).toEqual([]);
  });
});
