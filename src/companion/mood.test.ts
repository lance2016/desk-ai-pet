import { describe, expect, it } from "vitest";
import { moodLine, moodOf } from "./mood";

const NOON = new Date(2026, 10, 17, 12).getTime();
const HOUR = 60 * 60_000;
const day = (focusToday: number, doneToday: number) => ({ focusToday, doneToday });
const calmDay = { upLateNow: false, lateCareAt: undefined };

describe("moodOf", () => {
  it("is bright once the user got a few things done today", () => {
    expect(moodOf(day(0, 0), NOON, calmDay)).toBe("calm");
    expect(moodOf(day(1, 1), NOON, calmDay)).toBe("calm");
    expect(moodOf(day(2, 1), NOON, calmDay)).toBe("bright");
    expect(moodOf(day(0, 3), NOON, calmDay)).toBe("bright");
  });

  it("is tired while the user is up late, whatever got done", () => {
    expect(moodOf(day(5, 5), NOON, { upLateNow: true, lateCareAt: undefined })).toBe("tired");
  });

  it("stays tired the morning after a late night, and is over it by the afternoon", () => {
    expect(moodOf(day(0, 0), NOON, { upLateNow: false, lateCareAt: NOON - 11 * HOUR })).toBe("tired");
    expect(moodOf(day(3, 0), NOON, { upLateNow: false, lateCareAt: NOON - 13 * HOUR })).toBe("bright");
  });
});

describe("moodLine", () => {
  it("tells the model how the pet feels, and nothing on an ordinary day", () => {
    expect(moodLine("bright")).toEqual(["你今天心情很好，因为用户今天做成了不少事"]);
    expect(moodLine("tired")).toEqual(["你有点困了，因为用户熬夜，你一直陪着"]);
    expect(moodLine("calm")).toEqual([]);
  });
});
