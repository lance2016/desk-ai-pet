import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { hushedUntil, nextMorning, setHush } from "./hush";

const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime();

describe("nextMorning", () => {
  it("is tomorrow's morning time for the rest of today", () => {
    expect(nextMorning(at(17, 21), "08:00")).toBe(at(18, 8));
    expect(nextMorning(at(17, 7, 30), "08:00")).toBe(at(18, 8));
    expect(nextMorning(at(17, 15), "09:30")).toBe(at(18, 9, 30));
  });

  it("is this morning after midnight: the night is not over yet", () => {
    expect(nextMorning(at(18, 1, 30), "08:00")).toBe(at(18, 8));
  });

  it("is the next one when an early morning time has already passed tonight", () => {
    expect(nextMorning(at(18, 3, 45), "03:30")).toBe(at(19, 3, 30));
  });
});

describe("hush", () => {
  it("holds until its time, then is over by itself", () => {
    const storage = createMemoryStorage();
    expect(hushedUntil(at(17, 21), storage)).toBeNull();
    setHush(at(18, 8), storage);
    expect(hushedUntil(at(17, 23), storage)).toBe(at(18, 8));
    expect(hushedUntil(at(18, 8), storage)).toBeNull();
  });

  it("can be lifted, and ignores unreadable data", () => {
    const storage = createMemoryStorage();
    setHush(at(18, 8), storage);
    setHush(null, storage);
    expect(hushedUntil(at(17, 23), storage)).toBeNull();
    storage.setItem("ai-pet:companion-hush:v1", "{");
    expect(hushedUntil(at(17, 23), storage)).toBeNull();
  });
});
