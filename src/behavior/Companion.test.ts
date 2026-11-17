import { describe, expect, it, vi } from "vitest";
import { Companion } from "./Companion";
import { DEFAULT_COMPANION } from "../preferences/CompanionPreferences";
import { createMemoryStorage } from "../testing/fixtures";

const MINUTE = 60_000;
function sample(companion: Companion, from: number, until: number, idle = 0, busy = false) {
  for (let time = from; time <= until; time += MINUTE) companion.check(time, idle, DEFAULT_COMPANION, busy);
}

describe("companion activity", () => {
  it("waits for activity and greets only once per night, including after restart", () => {
    const storage = createMemoryStorage();
    const greet = vi.fn(() => true);
    const start = new Date(2026, 10, 17, 23, 30).getTime();
    sample(new Companion(storage, greet), start, start + 20 * MINUTE);
    sample(new Companion(storage, greet), start + 21 * MINUTE, start + 41 * MINUTE);
    expect(greet).toHaveBeenCalledTimes(1);
    expect(greet).toHaveBeenCalledWith(expect.stringContaining("很晚"), false);
  });

  it("restarts the rest timer after a real break and does not guess across missing samples", () => {
    const greet = vi.fn(() => true);
    const companion = new Companion(createMemoryStorage(), greet);
    const start = new Date(2026, 10, 17, 10).getTime();
    sample(companion, start, start + 50 * MINUTE);
    companion.check(start + 51 * MINUTE, 300, DEFAULT_COMPANION, false);
    sample(companion, start + 52 * MINUTE, start + 141 * MINUTE);
    expect(greet).not.toHaveBeenCalled();
    companion.check(start + 142 * MINUTE, 0, DEFAULT_COMPANION, false);
    expect(greet).toHaveBeenCalledTimes(1);
    companion.check(start + 300 * MINUTE, 0, DEFAULT_COMPANION, false);
    expect(greet).toHaveBeenCalledTimes(1);
  });

  it("welcomes a return once and suppresses greetings during focus", () => {
    const greet = vi.fn(() => true);
    const companion = new Companion(createMemoryStorage(), greet);
    const start = new Date(2026, 10, 17, 10).getTime();
    companion.check(start, 1800, DEFAULT_COMPANION, false);
    companion.check(start + MINUTE, 0, DEFAULT_COMPANION, false);
    expect(greet).toHaveBeenCalledTimes(1);
    companion.check(start + 2 * MINUTE, 1800, DEFAULT_COMPANION, false);
    companion.check(start + 3 * MINUTE, 0, DEFAULT_COMPANION, true);
    expect(greet).toHaveBeenCalledTimes(1);
  });
});
