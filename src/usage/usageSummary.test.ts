import { describe, expect, it } from "vitest";
import { addDays, dateKey, type WorkEvent, type WorkLogData } from "../worklog/WorkLog";
import { USAGE_FEATURES, usageKind } from "./usage";
import { USAGE_ROWS } from "./usageRows";
import { changeText, summarizeUsage } from "./usageSummary";

/** A Thursday afternoon. */
const NOW = new Date(2026, 10, 26, 15, 30).getTime();

function event(kind: string, at: number): WorkEvent {
  return { at, day: dateKey(at), kind, source: "user", text: "", before: null, itemId: null };
}
const at = (daysAgo: number, hour: number) => {
  const day = new Date(addDays(NOW, -daysAgo));
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0).getTime();
};
const line = (summary: ReturnType<typeof summarizeUsage>, id: string) => summary.groups.flatMap((group) => group.lines).find((item) => item.id === id);

describe("summarizeUsage", () => {
  it("counts each feature in the range and the range before it", () => {
    const log: WorkLogData = {
      events: [
        event(usageKind("quick_chat"), at(0, 9)),
        event(usageKind("quick_chat"), at(6, 9)),
        event(usageKind("quick_chat"), at(7, 9)),
        event(usageKind("quick_chat"), at(10, 9)),
        event(usageKind("quick_chat"), at(14, 9)),
      ],
      counts: [],
    };
    expect(line(summarizeUsage(log, NOW, 7), "quick_chat")).toMatchObject({ count: 2, previous: 2, daily: [1, 0, 0, 0, 0, 0, 1] });
    expect(line(summarizeUsage(log, NOW, 30), "quick_chat")).toMatchObject({ count: 5, previous: 0 });
  });

  it("adds up several kinds on one line and the counts of folded days", () => {
    const log: WorkLogData = {
      events: [event("focus_completed", at(0, 10)), event("focus_stopped", at(0, 11))],
      counts: [{ day: dateKey(addDays(NOW, -20)), kind: "focus_completed", count: 4 }],
    };
    expect(line(summarizeUsage(log, NOW, 30), "focus")?.count).toBe(6);
  });

  it("totals the user's uses and active days, leaving out the pet's own and unknown kinds", () => {
    const log: WorkLogData = {
      events: [
        event(usageKind("quick_chat"), at(0, 9)), event(usageKind("petted"), at(0, 10)), event(usageKind("petted"), at(2, 10)),
        event("agent_turn_done", at(1, 9)), event(usageKind("greeting"), at(3, 9)), event("reminder_edited", at(4, 9)),
        event(usageKind("quick_chat"), at(9, 9)),
      ],
      counts: [],
    };
    const summary = summarizeUsage(log, NOW, 7);
    expect(summary.uses).toEqual({ count: 3, previous: 1 });
    expect(summary.activeDays).toEqual({ count: 2, previous: 1 });
    expect(summary.top?.id).toBe("petted");
    expect(summary.agentTurns).toBe(1);
  });

  it("charts every day of the range, today last, for one feature when asked", () => {
    const log: WorkLogData = {
      events: [event(usageKind("quick_chat"), at(0, 9)), event(usageKind("petted"), at(0, 9)), event("agent_turn_done", at(0, 9))],
      counts: [{ day: dateKey(addDays(NOW, -5)), kind: "reminder_done", count: 2 }],
    };
    const days = summarizeUsage(log, NOW, 7).days;
    expect(days).toHaveLength(7);
    expect(days[6]).toEqual({ day: dateKey(NOW), count: 2, weekday: 3 });
    expect(days[1].count).toBe(2);
    expect(summarizeUsage(log, NOW, 7, "quick_chat").days[6].count).toBe(1);
    expect(summarizeUsage(log, NOW, 7, "agent_turn").days[6].count).toBe(2);
  });

  it("puts the uses into weekday and hour cells, from events only", () => {
    const log: WorkLogData = {
      events: [event(usageKind("quick_chat"), at(0, 9)), event(usageKind("chat_send"), at(0, 9)), event(usageKind("petted"), at(1, 22)), event("agent_turn_done", at(0, 9))],
      counts: [{ day: dateKey(NOW), kind: usageKind("petted"), count: 5 }],
    };
    const { heat } = summarizeUsage(log, NOW, 7);
    expect(heat).toHaveLength(7);
    expect(heat[3][9]).toBe(2);
    expect(heat[2][22]).toBe(1);
    expect(heat.flat().reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it("tells how often the pet's lines were answered, and whether the range before can be compared", () => {
    const log: WorkLogData = {
      events: [event(usageKind("greeting"), at(4, 8)), event(usageKind("greeting"), at(3, 8)), event(usageKind("greeting_reply"), at(3, 8))],
      counts: [],
    };
    const summary = summarizeUsage(log, NOW, 7);
    expect(summary.greetings).toMatchObject({ said: 2, answered: 1 });
    expect(summary.since).toBe(dateKey(at(4, 8)));
    expect(summary.comparable).toBe(false);
    expect(summarizeUsage({ events: [event(usageKind("petted"), at(20, 8))], counts: [] }, NOW, 7).comparable).toBe(true);
    expect(summarizeUsage({ events: [], counts: [] }, NOW, 7)).toMatchObject({ since: null, comparable: false, top: null });
  });

  it("has a line for every feature, and the kinds fit the native log", () => {
    const kinds = USAGE_ROWS.flatMap((row) => row.kinds);
    for (const feature of USAGE_FEATURES) expect(kinds).toContain(usageKind(feature));
    for (const kind of kinds) expect(kind).toMatch(/^[a-z_]{1,32}$/);
  });
});

describe("changeText", () => {
  it("says how a count moved against the one before", () => {
    expect(changeText(12, 10)).toBe("↑ 20%");
    expect(changeText(5, 10)).toBe("↓ 50%");
    expect(changeText(10, 10)).toBe("持平");
    expect(changeText(3, 0)).toBe("新");
    expect(changeText(0, 0)).toBe("持平");
  });
});
