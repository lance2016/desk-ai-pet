import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { alreadySaid, lastSaid, loadHistory, recordSaid } from "./history";

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
});
