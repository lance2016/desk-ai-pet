import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { dateKey, FOCUS_LOG_DAYS, focusRounds, loadFocusLog, recordFocusRound } from "./FocusLog";

const DAY = 24 * 60 * 60_000;
const NOW = new Date(2026, 10, 16, 15, 0).getTime();

describe("focus log", () => {
  it("counts finished rounds per local day", () => {
    const storage = createMemoryStorage();
    recordFocusRound(NOW - DAY, storage);
    recordFocusRound(NOW, storage);
    recordFocusRound(NOW, storage);
    const log = loadFocusLog(storage);
    expect(dateKey(NOW)).toBe("2026-11-16");
    expect(focusRounds(log, NOW)).toBe(2);
    expect(focusRounds(log, NOW - DAY)).toBe(1);
    expect(focusRounds(log, NOW - 2 * DAY)).toBe(0);
  });

  it("forgets old days", () => {
    const storage = createMemoryStorage();
    recordFocusRound(NOW - (FOCUS_LOG_DAYS + 1) * DAY, storage);
    recordFocusRound(NOW, storage);
    expect(Object.keys(loadFocusLog(storage))).toEqual(["2026-11-16"]);
  });
});
