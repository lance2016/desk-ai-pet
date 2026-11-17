import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { DEFAULT_QUIET_PREFERENCES, isQuietAt, loadQuietPreferences, saveQuietPreferences, type QuietPreferences } from "./QuietPreferences";

const at = (hours: number, minutes = 0) => new Date(2026, 10, 16, hours, minutes).getTime();
const hours = (start: string, end: string, enabled = true): QuietPreferences => ({ doNotDisturb: false, quietHours: { enabled, start, end } });

describe("quiet time", () => {
  it("is quiet all day while do-not-disturb is on", () => {
    const value = { ...hours("23:00", "08:00", false), doNotDisturb: true };
    expect(isQuietAt(value, at(14))).toBe(true);
  });

  it("covers quiet hours that run past midnight", () => {
    const value = hours("23:00", "08:00");
    expect(isQuietAt(value, at(23, 30))).toBe(true);
    expect(isQuietAt(value, at(7, 59))).toBe(true);
    expect(isQuietAt(value, at(8))).toBe(false);
    expect(isQuietAt(value, at(22, 59))).toBe(false);
  });

  it("covers quiet hours within one day", () => {
    const value = hours("12:00", "13:30");
    expect(isQuietAt(value, at(12, 15))).toBe(true);
    expect(isQuietAt(value, at(13, 30))).toBe(false);
  });

  it("ignores quiet hours that are off or empty", () => {
    expect(isQuietAt(hours("00:00", "23:59", false), at(12))).toBe(false);
    expect(isQuietAt(hours("09:00", "09:00"), at(9))).toBe(false);
  });
});

describe("quiet preferences storage", () => {
  it("saves and loads", () => {
    const storage = createMemoryStorage();
    const value = { ...hours("22:30", "07:00"), doNotDisturb: true };
    saveQuietPreferences(value, storage);
    expect(loadQuietPreferences(storage)).toEqual(value);
  });

  it("falls back to the defaults on missing or bad data", () => {
    expect(loadQuietPreferences(createMemoryStorage())).toEqual(DEFAULT_QUIET_PREFERENCES);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = createMemoryStorage({ "ai-pet:quiet-preferences:v1": JSON.stringify(hours("25:00", "08:00")) });
    expect(loadQuietPreferences(storage)).toEqual(DEFAULT_QUIET_PREFERENCES);
    warning.mockRestore();
  });

  it("refuses to save an invalid time", () => {
    expect(() => saveQuietPreferences(hours("8:00", "09:00"), createMemoryStorage())).toThrow();
  });
});
