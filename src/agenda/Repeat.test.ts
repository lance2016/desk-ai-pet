import { describe, expect, it } from "vitest";
import { currentOccurrence, EVERY_DAY, nextOccurrence, parseRepeat, repeatLabel, repeatSchema } from "./Repeat";
import { buildCalendar } from "./Workdays";

const calendar = buildCalendar();
/** 2026-11-16 is a Monday. */
const at = (day: number, hours: number) => new Date(2026, 10, day, hours, 0).getTime();

describe("repeat rules", () => {
  it("read the model's rule", () => {
    expect(parseRepeat("workdays")).toBe("workdays");
    expect(parseRepeat(" Daily ")).toEqual(EVERY_DAY);
    expect(parseRepeat("1, 3,5")).toEqual([1, 3, 5]);
    expect(parseRepeat("7,1,1")).toEqual([0, 1]);
    expect(parseRepeat("weekly")).toBeNull();
    expect(parseRepeat("0,8")).toBeNull();
  });

  it("refuse an empty or impossible list of days", () => {
    expect(() => repeatSchema.parse([])).toThrow();
    expect(() => repeatSchema.parse([7])).toThrow();
  });

  it("are named the Chinese way, Monday first", () => {
    expect(repeatLabel("workdays")).toBe("工作日");
    expect(repeatLabel(EVERY_DAY)).toBe("每天");
    expect(repeatLabel([0, 1, 3])).toBe("每周一、三、日");
  });
});

describe("occurrences", () => {
  it("are the latest one whose time has come", () => {
    expect(currentOccurrence([1, 3], at(16, 11), at(18, 9), calendar)).toBe(at(16, 11));
    expect(currentOccurrence([1, 3], at(16, 11), at(18, 11), calendar)).toBe(at(18, 11));
    expect(currentOccurrence([1, 3], at(16, 11), at(20, 9), calendar)).toBe(at(18, 11));
  });

  it("do not exist before the first one", () => {
    expect(currentOccurrence([1, 3], at(18, 11), at(17, 12), calendar)).toBeNull();
    expect(nextOccurrence([1, 3], at(18, 11), at(16, 12), calendar)).toBe(at(18, 11));
  });
});
