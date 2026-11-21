import { describe, expect, it } from "vitest";
import type { AgendaItem } from "../agenda/AgendaStore";
import { collectFacts, factLines, templateGreeting, type GreetingFacts } from "./GreetingContent";

const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime();
const NOW = at(16, 8, 30);

function item(overrides: Partial<AgendaItem>): AgendaItem {
  return { id: "a", text: "开会", remindAt: at(16, 7), repeat: null, createdAt: at(16, 8), doneAt: null, remindedAt: null, ...overrides };
}

const EMPTY: GreetingFacts = { openCount: 0, doneToday: 0, nextReminder: null, latestReminder: null, focusToday: 0, lastDay: null, leftovers: [] };
const event = (day: string, kind: string, text = "", itemId: string | null = null) => ({ at: 0, day, kind, source: "user", text, before: null, itemId });

describe("greeting facts", () => {
  it("sums up the agenda, today's focus rounds, the last day and what was left over", () => {
    const items = [
      item({ id: "next", text: "开会", remindAt: at(16, 10) }),
      item({ id: "later", text: "取快递", remindAt: at(16, 17) }),
      item({ id: "shown", text: "喝水", remindAt: at(16, 8), remindedAt: at(16, 8) }),
      item({ id: "done", text: "交周报", doneAt: at(16, 8, 10) }),
      item({ id: "old", text: "旧事", doneAt: at(15, 20) }),
      item({ id: "future", text: "下周的事", remindAt: at(23, 9) }),
      item({ id: "left", text: "回邮件", remindAt: at(13, 15), remindedAt: at(13, 15) }),
    ];
    const log = {
      events: [event("2026-11-13", "reminder_done", "写方案", "a"), event("2026-11-13", "focus_completed"), event("2026-11-16", "focus_completed")],
      counts: [{ day: "2026-11-13", kind: "focus_completed", count: 2 }],
    };
    expect(collectFacts(items, log, NOW)).toEqual({
      openCount: 4,
      doneToday: 1,
      nextReminder: { text: "开会", at: at(16, 10) },
      latestReminder: { text: "喝水", at: at(16, 8) },
      focusToday: 1,
      lastDay: { label: "11月13日 周五", done: ["写方案"], doneCount: 1, focusRounds: 3, agentWork: null },
      leftovers: [{ text: "回邮件", at: at(13, 15) }],
    });
  });

  it("tells the morning what Claude Code finished on the last day", () => {
    const log = { events: [event("2026-11-15", "agent_turn_done", "ai-pet"), event("2026-11-15", "agent_turn_done", "ai-pet")], counts: [] };
    const facts = collectFacts([], log, NOW);
    expect(facts.lastDay?.agentWork).toBe("让 Claude Code 干完了 2 轮活：ai-pet 2 轮");
    expect(factLines("morning", facts, NOW)).toContain("昨天让 Claude Code 干完了 2 轮活：ai-pet 2 轮");
  });

  it("calls the day before today 昨天", () => {
    const facts = collectFacts([], { events: [event("2026-11-15", "focus_completed")], counts: [] }, NOW);
    expect(facts.lastDay?.label).toBe("昨天");
  });
});

describe("fact lines for the model", () => {
  it("tells the morning about the day ahead and the evening about the day done", () => {
    const facts = {
      ...EMPTY, openCount: 2, doneToday: 1, nextReminder: { text: "开会", at: at(16, 10) }, latestReminder: { text: "喝水", at: at(16, 8) }, focusToday: 2,
      lastDay: { label: "昨天", done: ["写方案"], doneCount: 1, focusRounds: 3, agentWork: null },
      leftovers: [{ text: "回邮件", at: at(15, 15) }],
    };
    expect(factLines("morning", facts, NOW)).toEqual(["今天要处理的提醒 2 个", "下一个提醒：10:00 开会", "昨天完成了 1 个提醒：写方案", "昨天专注了 3 轮，每轮 25 分钟", "之前没做完的提醒 1 个：11月15日 周日 15:00 回邮件"]);
    expect(factLines("evening", facts, NOW)).toEqual(["今天完成了 1 个提醒，还有 2 个没处理", "今天专注了 2 轮，每轮 25 分钟", "最近一次提醒：08:00 喝水"]);
  });
});

describe("template greeting", () => {
  it("says hello for the time of day and mentions the first reminder", () => {
    expect(templateGreeting("morning", { ...EMPTY, openCount: 3, nextReminder: { text: "开会", at: at(16, 10) } }, NOW)).toBe("早上好！今天有 3 个提醒，10:00 要开会。");
    expect(templateGreeting("morning", EMPTY, at(16, 15))).toBe("下午好！今天也一起加油吧～");
    expect(templateGreeting("morning", { ...EMPTY, leftovers: [{ text: "回邮件", at: at(15, 15) }] }, NOW)).toBe("早上好！之前还有 1 个提醒没做完，要挪到今天吗？");
  });

  it("praises the day in the evening", () => {
    expect(templateGreeting("evening", { ...EMPTY, focusToday: 2, doneToday: 3 }, at(16, 22, 30))).toBe("晚上好～今天专注了 2 轮，完成了 3 个提醒，早点休息哦。");
    expect(templateGreeting("evening", EMPTY, at(16, 22, 30))).toBe("晚上好～今天辛苦啦，早点休息哦。");
  });
});
