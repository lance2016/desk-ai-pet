import { describe, expect, it } from "vitest";
import { parseClock, stepClock } from "./clockText";

describe("parseClock", () => {
  it("reads what people type for a time of day", () => {
    expect(parseClock("22:30")).toBe("22:30");
    expect(parseClock("9:05")).toBe("09:05");
    expect(parseClock("9:5")).toBe("09:05");
    expect(parseClock("2230")).toBe("22:30");
    expect(parseClock("930")).toBe("09:30");
    expect(parseClock("9")).toBe("09:00");
    expect(parseClock("22")).toBe("22:00");
    expect(parseClock(" 7：45 ")).toBe("07:45");
    expect(parseClock("7.45")).toBe("07:45");
    expect(parseClock("00:00")).toBe("00:00");
  });

  it("rejects what is not a time of day", () => {
    for (const text of ["", " ", "24:00", "12:60", "25", "12345", "ab", "1:2:3", "-1:00", ":30", "12:"]) expect(parseClock(text)).toBeNull();
  });
});

describe("stepClock", () => {
  it("moves the hour or the minute and wraps within it", () => {
    expect(stepClock("22:30", "hour", 1)).toBe("23:30");
    expect(stepClock("23:30", "hour", 1)).toBe("00:30");
    expect(stepClock("00:30", "hour", -1)).toBe("23:30");
    expect(stepClock("22:59", "minute", 1)).toBe("22:00");
    expect(stepClock("22:00", "minute", -1)).toBe("22:59");
  });
});
