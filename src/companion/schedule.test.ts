import { describe, expect, it } from "vitest";
import { DEFAULT_COMPANION } from "../preferences/CompanionPreferences";
import { DEFAULT_QUIET_PREFERENCES } from "../preferences/QuietPreferences";
import { decide } from "./schedule";
import type { Cue, Moment, Occasion } from "./types";

const NOW = new Date(2026, 10, 16, 9).getTime();
const MOMENT: Moment = { now: NOW, activeMs: 0, returned: false, leftAt: null, paused: true, reminders: [], settings: DEFAULT_COMPANION, quietHours: DEFAULT_QUIET_PREFERENCES.quietHours, lastSaid: {} };
const occasion = (id: string, cue: Cue | null): Occasion => ({ id, title: id, wording: "fixed", line: id, due: () => cue });
const always = () => true;
const TYPING: Moment = { ...MOMENT, paused: false };

describe("decide", () => {
  it("speaks for the first occasion that is due", () => {
    const table = [occasion("a", null), occasion("b", {}), occasion("c", {})];
    expect(decide(table, MOMENT, [], always)?.occasion.id).toBe("b");
    expect(decide([occasion("a", null)], MOMENT, [], always)).toBeNull();
  });

  it("passes over a subject already spoken for", () => {
    const table = [occasion("a", { subject: "today" }), occasion("b", {})];
    expect(decide(table, MOMENT, [{ occasion: "a", subject: "today", at: NOW }], always)?.occasion.id).toBe("b");
    expect(decide(table, MOMENT, [{ occasion: "a", subject: "yesterday", at: NOW }], always)?.occasion.id).toBe("a");
  });

  it("passes over an occasion that may not speak up now", () => {
    const table = [occasion("a", {}), occasion("b", { allowQuiet: true })];
    const quietHours = (allowQuiet: boolean) => allowQuiet;
    expect(decide(table, MOMENT, [], quietHours)?.occasion.id).toBe("b");
    expect(decide(table, MOMENT, [], () => false)).toBeNull();
  });

  it("does not cut into the user's typing, except for a line that cannot wait", () => {
    const table = [occasion("a", {}), occasion("b", { rightAway: true })];
    expect(decide(table, TYPING, [], always)?.occasion.id).toBe("b");
    expect(decide([occasion("a", {})], TYPING, [], always)).toBeNull();
    expect(decide(table, MOMENT, [], always)?.occasion.id).toBe("a");
  });
});
