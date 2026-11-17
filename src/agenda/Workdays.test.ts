import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { buildCalendar, isWorkday, lastCoveredYear, missingYears, parseHolidayYear, refreshHolidays } from "./Workdays";

const day = (year: number, month: number, date: number) => new Date(year, month - 1, date, 9, 0);
const YEAR_2028 = JSON.stringify({ holidays: { "2028-01-03": "New Year's Day,元旦,1" }, workdays: { "2028-01-08": "New Year's Day,元旦,1" }, inLieuDays: {} });

describe("official working days", () => {
  const calendar = buildCalendar();

  it("skips public holidays and counts make-up weekend days", () => {
    expect(isWorkday(calendar, day(2026, 11, 16))).toBe(true); // Monday
    expect(isWorkday(calendar, day(2026, 11, 21))).toBe(false); // Saturday
    expect(isWorkday(calendar, day(2026, 10, 1))).toBe(false); // National Day, a Thursday
    expect(isWorkday(calendar, day(2026, 10, 10))).toBe(true); // Saturday worked in lieu
    expect(isWorkday(calendar, day(2027, 1, 31))).toBe(true); // Sunday before Spring Festival 2027
  });

  it("falls back to Monday to Friday for years without a schedule", () => {
    expect(isWorkday(calendar, day(2030, 1, 1))).toBe(true); // Tuesday
    expect(isWorkday(calendar, day(2030, 1, 5))).toBe(false); // Saturday
  });

  it("lets a downloaded year replace the bundled one", () => {
    const replaced = buildCalendar({ "2026": { holidays: { "2026-11-16": "test" }, workdays: {} } });
    expect(isWorkday(replaced, day(2026, 11, 16))).toBe(false);
    expect(isWorkday(replaced, day(2026, 10, 1))).toBe(true);
  });

  it("knows the last year it covers", () => {
    expect(lastCoveredYear(calendar)).toBe(2027);
    expect(lastCoveredYear(buildCalendar({ "2028": parseHolidayYear(YEAR_2028, 2028) }))).toBe(2028);
  });
});

describe("missing years", () => {
  const calendar = buildCalendar();

  it("asks for this year, and for next year from October on", () => {
    expect(missingYears(calendar, day(2026, 11, 16).getTime())).toEqual([]);
    expect(missingYears(calendar, day(2027, 9, 30).getTime())).toEqual([]);
    expect(missingYears(calendar, day(2027, 10, 1).getTime())).toEqual([2028]);
    expect(missingYears(calendar, day(2028, 2, 1).getTime())).toEqual([2028]);
  });

  it("accepts only a non-empty file for the year asked", () => {
    expect(parseHolidayYear(YEAR_2028, 2028).workdays).toEqual({ "2028-01-08": "New Year's Day,元旦,1" });
    expect(() => parseHolidayYear(YEAR_2028, 2029)).toThrow();
    expect(() => parseHolidayYear(JSON.stringify({ holidays: {}, workdays: {} }), 2028)).toThrow();
    expect(() => parseHolidayYear("not json", 2028)).toThrow();
  });
});

describe("refreshing holidays", () => {
  const NOW = day(2027, 11, 20).getTime();

  it("downloads a missing year once a day", async () => {
    const storage = createMemoryStorage();
    const download = vi.fn(async () => YEAR_2028);
    await refreshHolidays(NOW, download, storage);
    await refreshHolidays(NOW + 60_000, download, storage);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith(2028);
    const stored = JSON.parse(storage.getItem("ai-pet:holidays:v1") ?? "{}");
    expect(isWorkday(buildCalendar(stored.years), day(2028, 1, 3))).toBe(false);
  });

  it("tries again the next day while the year is not published", async () => {
    const storage = createMemoryStorage();
    const download = vi.fn(async () => null);
    await refreshHolidays(NOW, download, storage);
    await refreshHolidays(NOW + 24 * 3_600_000, download, storage);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("tries again on the next call after a failed download", async () => {
    const storage = createMemoryStorage();
    await expect(refreshHolidays(NOW, async () => { throw new Error("offline"); }, storage)).rejects.toThrow("offline");
    const download = vi.fn(async () => YEAR_2028);
    await refreshHolidays(NOW, download, storage);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no year is missing", async () => {
    const storage = createMemoryStorage();
    const download = vi.fn(async () => YEAR_2028);
    await refreshHolidays(day(2026, 11, 16).getTime(), download, storage);
    expect(download).not.toHaveBeenCalled();
    expect(storage.getItem("ai-pet:holidays:v1")).toBeNull();
  });
});
