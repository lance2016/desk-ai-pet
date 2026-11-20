import { describe, expect, it } from "vitest";
import { eveningGreetingTime, greetingDay, greetingDue } from "./GreetingSchedule";

const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime();
const NIGHT = { enabled: true, start: "23:00", end: "08:00" };

describe("greeting schedule", () => {
  it("says good morning in the few hours after quiet hours end, not in the evening", () => {
    expect(greetingDue(at(16, 7, 59), NIGHT)).toBeNull();
    expect(greetingDue(at(16, 8), NIGHT)).toBe("morning");
    expect(greetingDue(at(16, 11, 59), NIGHT)).toBe("morning");
    expect(greetingDue(at(16, 12), NIGHT)).toBeNull();
    expect(greetingDue(at(16, 21), NIGHT)).toBeNull();
  });

  it("says good night in the half hour before quiet hours", () => {
    expect(greetingDue(at(16, 22, 30), NIGHT)).toBe("evening");
    expect(greetingDue(at(16, 22, 59), NIGHT)).toBe("evening");
    expect(greetingDue(at(16, 23), NIGHT)).toBeNull();
  });

  it("keeps a night that runs past midnight on the same day", () => {
    const late = { enabled: true, start: "01:00", end: "09:00" };
    expect(greetingDue(at(17, 0, 40), late)).toBe("evening");
    expect(greetingDay(at(17, 0, 40), "09:00")).toBe(greetingDay(at(16, 10), "09:00"));
  });

  it("uses the independent morning time", () => {
    expect(greetingDue(at(16, 8, 59), NIGHT, "09:00")).toBeNull();
    expect(greetingDue(at(16, 9), NIGHT, "09:00")).toBe("morning");
    expect(greetingDue(at(16, 8), NIGHT, "07:00")).toBe("morning");
  });

  it("uses the configured times even when quiet hours are off", () => {
    expect(greetingDue(at(16, 22, 45), { ...NIGHT, enabled: false })).toBe("evening");
  });
});

describe("evening greeting time", () => {
  it("is half an hour before quiet hours start, across midnight too", () => {
    expect(eveningGreetingTime("23:00")).toBe("22:30");
    expect(eveningGreetingTime("22:15")).toBe("21:45");
    expect(eveningGreetingTime("00:10")).toBe("23:40");
  });
});
