import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { ANSWER_WINDOW_MS, alreadySaid, lastSaid, loadHistory, markAnswered, recordSaid, unanswered } from "./history";

const DAY = 24 * 60 * 60_000;
const NOW = new Date(2026, 10, 16, 9).getTime();

describe("companion history", () => {
  it("starts empty and remembers what was said", () => {
    const storage = createMemoryStorage();
    expect(loadHistory(storage)).toEqual([]);
    recordSaid({ occasion: "morning", subject: "2026-11-16", at: NOW }, storage);
    recordSaid({ occasion: "rest", subject: null, at: NOW + 1000 }, storage);
    recordSaid({ occasion: "rest", subject: null, at: NOW + 5000 }, storage);
    const history = loadHistory(storage);
    expect(alreadySaid(history, "morning", "2026-11-16")).toBe(true);
    expect(alreadySaid(history, "morning", "2026-11-17")).toBe(false);
    expect(alreadySaid(history, "evening", "2026-11-16")).toBe(false);
    expect(lastSaid(history)).toEqual({ morning: NOW, rest: NOW + 5000 });
  });

  it("drops entries older than a week", () => {
    const storage = createMemoryStorage();
    recordSaid({ occasion: "morning", subject: "2026-11-16", at: NOW }, storage);
    recordSaid({ occasion: "morning", subject: "2026-11-24", at: NOW + 8 * DAY }, storage);
    expect(loadHistory(storage).map((said) => said.subject)).toEqual(["2026-11-24"]);
  });

  it("ignores a broken record", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadHistory(createMemoryStorage({ "ai-pet:companion-history:v1": "{" }))).toEqual([]);
    warning.mockRestore();
  });

  it("counts a reaction soon after a line as an answer to it, once", () => {
    const storage = createMemoryStorage();
    expect(markAnswered(NOW, storage)).toBe(false);
    recordSaid({ occasion: "rest", subject: null, at: NOW }, storage);
    expect(markAnswered(NOW + ANSWER_WINDOW_MS, storage)).toBe(false);
    expect(markAnswered(NOW + 60_000, storage)).toBe(true);
    expect(markAnswered(NOW + 61_000, storage)).toBe(false);
    expect(loadHistory(storage)).toEqual([{ occasion: "rest", subject: null, at: NOW, answered: true }]);
  });

  it("counts how many of the latest lines of some occasions went by without an answer", () => {
    const care = new Set(["rest", "welcome_back"]);
    const said = (occasion: string, minute: number, answered?: boolean) => ({ occasion, subject: null, at: NOW + minute * 60_000, ...(answered ? { answered } : {}) });
    expect(unanswered([], care)).toBe(0);
    expect(unanswered([said("rest", 0), said("morning", 1), said("welcome_back", 2)], care)).toBe(2);
    expect(unanswered([said("rest", 0), said("rest", 90, true), said("rest", 180), said("rest", 270)], care)).toBe(2);
    expect(unanswered([said("rest", 0), said("rest", 90, true)], care)).toBe(0);
  });
});
