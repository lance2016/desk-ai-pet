import { describe, expect, it, vi } from "vitest";
import type { AgendaItem } from "./AgendaStore";
import { chatContext, confirmationFor, interpretToolCalls, NOTHING_SAVED, reminderLines, todayLines } from "./chatTools";

const NOW = new Date(2026, 10, 16, 14, 3).getTime();
const HOUR = 60 * 60_000;
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime();
const call = (name: string, args: unknown) => JSON.stringify({ name, arguments: JSON.stringify(args) });
let ids = 0;
const makeId = () => `id${++ids}`;

describe("chat context", () => {
  it("gives the local time with the weekday, and only action ids the native side accepts", () => {
    expect(chatContext(NOW, ["happy", "pet_reaction", "Bad-Id"], NOTHING_SAVED)).toMatchObject({ now: "2026-11-16 14:03 周一", timestamp: expect.stringMatching(/^2026-11-16T14:03:00[+-]\d{2}:\d{2}$/), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, actions: ["happy", "pet_reaction"], reminders: [], notes: [], today: ["专注了 0 轮，每轮 25 分钟"] });
  });

  it("hands over the notes pinned first, then the most recently changed", () => {
    const note = (id: string, pinned: boolean, updatedAt: number) => ({ id, text: id, pinned, createdAt: 0, updatedAt });
    expect(chatContext(NOW, [], { ...NOTHING_SAVED, notes: [note("old", false, 1), note("new", false, 2), note("pinned", true, 0)] }).notes).toEqual(["pinned", "new", "old"]);
  });

  it("lists open reminders by time with their rule, then finished one-offs", () => {
    const reminder = (overrides: Partial<AgendaItem>): AgendaItem => ({ id: "a", text: "开会", remindAt: NOW + HOUR, repeat: null, createdAt: 0, doneAt: null, remindedAt: null, ...overrides });
    const lines = reminderLines([
      reminder({ id: "done", text: "交周报", remindAt: NOW - HOUR, doneAt: NOW - HOUR }),
      reminder({ id: "pills", text: "吃药", remindAt: NOW - 2 * HOUR + 24 * HOUR, repeat: "workdays", createdAt: NOW - 48 * HOUR }),
      reminder({ id: "meeting" }),
    ], NOW);
    expect(lines).toEqual(["今天 15:03 开会", "明天 12:03（工作日） 吃药", "今天 13:03 交周报（已完成）"]);
  });

  it("records today: done and open reminders, focus rounds and today's notes", () => {
    const reminder = (overrides: Partial<AgendaItem>): AgendaItem => ({ id: "a", text: "开会", remindAt: NOW + HOUR, repeat: null, createdAt: 0, doneAt: null, remindedAt: null, ...overrides });
    const note = (text: string, updatedAt: number) => ({ id: text, text, pinned: false, createdAt: 0, updatedAt });
    const lines = todayLines({
      agenda: [
        reminder({ id: "report", text: "交周报", remindAt: NOW - HOUR, doneAt: NOW - HOUR }),
        reminder({ id: "old", text: "昨天的事", remindAt: NOW - 24 * HOUR, doneAt: NOW - 24 * HOUR }),
        reminder({ id: "meeting" }),
        reminder({ id: "tomorrow", text: "体检", remindAt: NOW + 24 * HOUR }),
      ],
      notes: [note("买牛奶\n和鸡蛋", NOW - HOUR), note("旧备忘", NOW - 24 * HOUR)],
      focusLog: { "2026-11-16": 3 },
    }, NOW);
    expect(lines).toEqual(["完成了提醒：交周报", "还没处理的提醒：今天 15:03 开会", "专注了 3 轮，每轮 25 分钟", "今天记的备忘：买牛奶 和鸡蛋"]);
  });
});

describe("tool calls", () => {
  const reminder = (text: string, remindAt: number, extra: object = {}) => ({ id: expect.any(String), text, remindAt, repeat: null, trimmed: false, onceOnly: false, ...extra });

  it("turns a reminder request into a reminder", () => {
    const result = interpretToolCalls([call("add_reminder", { text: "开会", remind_at: "2026-11-16 15:00" })], NOW, makeId);
    expect(result.items).toEqual([reminder("开会", at(16, 15))]);
    expect(result.failures).toEqual([]);
  });

  it("reads times with seconds or a T", () => {
    const result = interpretToolCalls([
      call("add_reminder", { text: "开会", remind_at: "2026-11-16 15:00:00" }),
      call("add_reminder", { text: "交周报", remind_at: "2026-11-17T09:30" }),
    ], NOW, makeId);
    expect(result.items.map((item) => item.remindAt)).toEqual([at(16, 15), at(17, 9, 30)]);
  });

  it("turns a repeating request into a repeating reminder, whatever day the model picked", () => {
    const result = interpretToolCalls([
      call("add_reminder", { text: "点外卖", remind_at: "2026-11-16 11:00", repeat: "workdays" }),
      call("add_reminder", { text: "吃药", remind_at: "2026-11-17 08:00", repeat: "daily" }),
      call("add_reminder", { text: "交周报", remind_at: "2026-11-20 17:00", repeat: "5" }),
    ], NOW, makeId);
    expect(result.items.map(({ text, remindAt, repeat }) => ({ text, remindAt, repeat }))).toEqual([
      { text: "点外卖", remindAt: at(16, 11), repeat: "workdays" },
      { text: "吃药", remindAt: at(17, 8), repeat: [0, 1, 2, 3, 4, 5, 6] },
      { text: "交周报", remindAt: at(20, 17), repeat: [5] },
    ]);
    expect(result.notes).toEqual([]);
  });

  it("sets an unsupported rule as a one-off reminder and says so", () => {
    const result = interpretToolCalls([call("add_reminder", { text: "交房租", remind_at: "2026-12-01 09:00", repeat: "monthly" })], NOW, makeId);
    expect(result.items).toEqual([reminder("交房租", at(31, 9), { onceOnly: true })]);
  });

  it("keeps a reminder without a time, or with a time already gone, as a note, with the reason", () => {
    const result = interpretToolCalls([
      call("add_reminder", { text: "买牛奶" }),
      call("add_reminder", { text: "交周报", remind_at: "2026-11-16 09:00" }),
      call("add_reminder", { text: "开会", remind_at: "2026-02-30 15:00" }),
    ], NOW, makeId);
    expect(result.items).toEqual([]);
    expect(result.notes).toEqual([
      { text: "买牛奶", trimmed: false, fallback: "no-time" },
      { text: "交周报", trimmed: false, fallback: "past" },
      { text: "开会", trimmed: false, fallback: "no-time" },
    ]);
  });

  it("cuts overlong text to the limit and marks it", () => {
    const result = interpretToolCalls([
      call("add_reminder", { text: "长".repeat(80), remind_at: "2026-11-16 15:00" }),
      call("save_note", { text: "记".repeat(600) }),
    ], NOW, makeId);
    expect(result.items[0]).toMatchObject({ text: "长".repeat(60), trimmed: true });
    expect(result.notes).toEqual([{ text: "记".repeat(500), trimmed: true }]);
  });

  it("reports calls it cannot save instead of dropping them", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = interpretToolCalls([
      call("add_reminder", { text: "" }),
      call("unknown_tool", {}),
      "not json",
      JSON.stringify({ name: "add_reminder", arguments: "{" }),
      JSON.stringify({ name: "save_note", arguments: "", overflow: true }),
      JSON.stringify({ name: "", arguments: "", dropped: 2 }),
    ], NOW, makeId);
    expect(result.items).toEqual([]);
    expect(result.notes).toEqual([]);
    expect(result.failures).toEqual(["没看懂要提醒什么", "没看懂这条记录请求", "没看懂这条记录请求", "没看懂要提醒什么", "内容太长", "一次最多记 8 条，后面 2 条没记上"]);
    warning.mockRestore();
  });

  it("collects notes to save, reporting empty ones", () => {
    const result = interpretToolCalls([call("save_note", { text: "  WiFi：abc123\n密码在背面  " }), call("save_note", { text: " " })], NOW, makeId);
    expect(result.notes).toEqual([{ text: "WiFi：abc123\n密码在背面", trimmed: false }]);
    expect(result.failures).toEqual(["没看懂要存什么"]);
  });
});

describe("confirmation", () => {
  it("speaks for the model when it only called tools", () => {
    expect(confirmationFor([{ id: "a", text: "开会", remindAt: at(16, 15) }], NOW)).toBe("好，15:00 提醒你：开会");
    expect(confirmationFor([{ id: "b", text: "开会", remindAt: at(17, 9) }], NOW, [{ text: "买牛奶", trimmed: false }])).toBe("好，明天 09:00 提醒你：开会。好，存进备忘了");
    expect(confirmationFor([{ id: "c", text: "点外卖", remindAt: at(16, 11), repeat: "workdays" }], NOW)).toBe("好，以后工作日 11:00 都提醒你：点外卖");
    expect(confirmationFor([], NOW)).toBe("");
  });

  it("says why a reminder became a note, and that something was not saved", () => {
    expect(confirmationFor([], NOW, [{ text: "吃药", trimmed: false, fallback: "past" }], ["内容太长"])).toBe("时间已经过了，先存进备忘了。有的没记上，看下面的说明");
  });
});
