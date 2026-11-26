import { describe, expect, it } from "vitest";
import { addDays, dateKey, type WorkEvent, type WorkLogData } from "../worklog/WorkLog";
import { USAGE_FEATURES, usageKind } from "./usage";
import { USAGE_DAYS, USAGE_ROWS, summarizeUsage } from "./usageSummary";

const NOW = new Date(2026, 10, 26, 15, 30).getTime();

function event(kind: string, at: number): WorkEvent {
  return { at, day: dateKey(at), kind, source: "user", text: "", before: null, itemId: null };
}
const at = (daysAgo: number, hour: number) => {
  const day = new Date(addDays(NOW, -daysAgo));
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0).getTime();
};

describe("summarizeUsage", () => {
  it("counts each feature over the last week and month, most used first", () => {
    const log: WorkLogData = {
      events: [
        event(usageKind("quick_chat"), at(0, 9)),
        event(usageKind("quick_chat"), at(10, 9)),
        event(usageKind("petted"), at(1, 9)),
        event(usageKind("petted"), at(2, 9)),
        event(usageKind("petted"), at(3, 9)),
      ],
      counts: [],
    };
    const { lines } = summarizeUsage(log, NOW);
    expect(lines[0]).toMatchObject({ id: "petted", week: 3, month: 3 });
    expect(lines[1]).toMatchObject({ id: "quick_chat", week: 1, month: 2 });
    expect(lines.find((line) => line.id === "dubbing")).toMatchObject({ week: 0, month: 0 });
  });

  it("adds up several kinds on one line and the counts of folded days", () => {
    const old = dateKey(addDays(NOW, -20));
    const log: WorkLogData = {
      events: [event("focus_completed", at(0, 10)), event("focus_stopped", at(0, 11))],
      counts: [{ day: old, kind: "focus_completed", count: 4 }],
    };
    expect(summarizeUsage(log, NOW).lines.find((line) => line.id === "focus")).toMatchObject({ week: 2, month: 6 });
  });

  it("leaves out days older than the month and kinds it does not know", () => {
    const log: WorkLogData = {
      events: [event(usageKind("petted"), at(USAGE_DAYS, 9)), event("reminder_edited", at(0, 9))],
      counts: [{ day: dateKey(addDays(NOW, -USAGE_DAYS - 3)), kind: usageKind("petted"), count: 9 }],
    };
    const summary = summarizeUsage(log, NOW);
    expect(summary.lines.every((line) => line.month === 0)).toBe(true);
    expect(summary.days.every((day) => day.count === 0)).toBe(true);
  });

  it("charts every day of the month, today last, with the user's uses only", () => {
    const log: WorkLogData = {
      events: [event(usageKind("quick_chat"), at(0, 9)), event("agent_turn_done", at(0, 9)), event(usageKind("greeting"), at(0, 9))],
      counts: [{ day: dateKey(addDays(NOW, -5)), kind: "reminder_done", count: 2 }],
    };
    const { days } = summarizeUsage(log, NOW);
    expect(days).toHaveLength(USAGE_DAYS);
    expect(days[USAGE_DAYS - 1]).toEqual({ day: dateKey(NOW), count: 1 });
    expect(days[USAGE_DAYS - 6].count).toBe(2);
  });

  it("puts the user's uses into hours of the day, from events only", () => {
    const log: WorkLogData = {
      events: [event(usageKind("quick_chat"), at(0, 9)), event(usageKind("petted"), at(1, 9)), event(usageKind("chat_send"), at(0, 22)), event("agent_turn_done", at(0, 9))],
      counts: [{ day: dateKey(NOW), kind: usageKind("petted"), count: 5 }],
    };
    const { hours } = summarizeUsage(log, NOW);
    expect(hours).toHaveLength(24);
    expect(hours[9]).toBe(2);
    expect(hours[22]).toBe(1);
    expect(hours.reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it("tells how often the pet's own lines were answered and when counting began", () => {
    const log: WorkLogData = {
      events: [event("reminder_added", at(12, 9)), event(usageKind("greeting"), at(4, 8)), event(usageKind("greeting"), at(3, 8)), event(usageKind("greeting_reply"), at(3, 8))],
      counts: [],
    };
    const summary = summarizeUsage(log, NOW);
    expect(summary.greetings).toEqual({ said: 2, answered: 1 });
    expect(summary.since).toBe(dateKey(at(4, 8)));
    expect(summarizeUsage({ events: [], counts: [] }, NOW).since).toBeNull();
  });

  it("has a line for every feature, and the kinds fit the native log", () => {
    const kinds = USAGE_ROWS.flatMap((row) => row.kinds);
    for (const feature of USAGE_FEATURES) expect(kinds).toContain(usageKind(feature));
    for (const kind of kinds) expect(kind).toMatch(/^[a-z_]{1,32}$/);
  });
});
