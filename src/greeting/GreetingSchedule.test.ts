import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { eveningGreetingTime, greetingDay, greetingDue, loadGreetingRecord, saveGreetingRecord, type GreetingRecord } from "./GreetingSchedule";

const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime();
const NIGHT = { enabled: true, start: "23:00", end: "08:00" };
const NONE: GreetingRecord = { morning: null, evening: null };

describe("greeting schedule", () => {
  it("says good morning in the few hours after quiet hours end, not in the evening", () => {
    expect(greetingDue(at(16, 7, 59), NIGHT, NONE)).toBeNull();
    expect(greetingDue(at(16, 8), NIGHT, NONE)).toBe("morning");
    expect(greetingDue(at(16, 11, 59), NIGHT, NONE)).toBe("morning");
    expect(greetingDue(at(16, 12), NIGHT, NONE)).toBeNull();
    expect(greetingDue(at(16, 21), NIGHT, NONE)).toBeNull();
  });

  it("says good night in the half hour before quiet hours", () => {
    expect(greetingDue(at(16, 22, 30), NIGHT, NONE)).toBe("evening");
    expect(greetingDue(at(16, 22, 59), NIGHT, NONE)).toBe("evening");
    expect(greetingDue(at(16, 23), NIGHT, NONE)).toBeNull();
  });

  it("greets once per day", () => {
    const day = greetingDay(at(16, 9), "08:00");
    const record = { morning: day, evening: null };
    expect(greetingDue(at(16, 12), NIGHT, record)).toBeNull();
    expect(greetingDue(at(16, 22, 40), NIGHT, record)).toBe("evening");
    expect(greetingDue(at(17, 8, 30), NIGHT, { morning: day, evening: day })).toBe("morning");
  });

  it("keeps a night that runs past midnight on the same day", () => {
    const late = { enabled: true, start: "01:00", end: "09:00" };
    expect(greetingDue(at(17, 0, 40), late, NONE)).toBe("evening");
    expect(greetingDay(at(17, 0, 40), "09:00")).toBe(greetingDay(at(16, 10), "09:00"));
  });

  it("uses the independent morning time", () => {
    expect(greetingDue(at(16, 8, 59), NIGHT, NONE, "09:00")).toBeNull();
    expect(greetingDue(at(16, 9), NIGHT, NONE, "09:00")).toBe("morning");
    expect(greetingDue(at(16, 8), NIGHT, NONE, "07:00")).toBe("morning");
  });

  it("uses the configured times even when quiet hours are off", () => {
    expect(greetingDue(at(16, 22, 45), { ...NIGHT, enabled: false }, NONE)).toBe("evening");
  });
});

describe("evening greeting time", () => {
  it("is half an hour before quiet hours start, across midnight too", () => {
    expect(eveningGreetingTime("23:00")).toBe("22:30");
    expect(eveningGreetingTime("22:15")).toBe("21:45");
    expect(eveningGreetingTime("00:10")).toBe("23:40");
  });
});

describe("greeting record", () => {
  it("saves and loads, starting empty", () => {
    const storage = createMemoryStorage();
    expect(loadGreetingRecord(storage)).toEqual(NONE);
    saveGreetingRecord({ morning: "2026-11-16", evening: null }, storage);
    expect(loadGreetingRecord(storage)).toEqual({ morning: "2026-11-16", evening: null });
  });
});
