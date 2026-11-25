import { describe, expect, it } from "vitest";
import type { AgendaItem } from "./AgendaStore";
import { NO_FACTS } from "../testing/fixtures";
import { chatContext, readNoteCall, readReminderCall, reminderConfirmation, reminderLines, todayLines } from "./chatTools";

const NOW = new Date(2026, 10, 16, 14, 3).getTime();
const HOUR = 60 * 60_000;
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime();
let ids = 0;
const makeId = () => `id${++ids}`;

describe("chat context", () => {
  it("gives the local time with the weekday, and only action ids the model may pick", () => {
    expect(chatContext(NOW, ["happy", "pet_reaction", "Bad-Id"], NO_FACTS)).toEqual({ now: "2026-11-16 14:03 周一", timestamp: expect.stringMatching(/^2026-11-16T14:03:00[+-]\d{2}:\d{2}$/), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, actions: ["happy", "pet_reaction"], facts: NO_FACTS });
    expect(chatContext(NOW, Array.from({ length: 40 }, (_, index) => `a${index}`), NO_FACTS).actions).toHaveLength(30);
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
    }, {
      events: [
        ...["focus_completed", "focus_completed", "focus_stopped"].map((kind) => ({ at: 0, day: "2026-11-16", kind, source: "user", text: "", before: null, itemId: null })),
        { at: 0, day: "2026-11-16", kind: "focus_completed", source: "user", text: "", before: null, itemId: null },
        { at: 0, day: "2026-11-15", kind: "focus_completed", source: "user", text: "", before: null, itemId: null },
      ],
      counts: [],
    }, NOW);
    expect(lines).toEqual(["完成了提醒：交周报", "还没处理的提醒：今天 15:03 开会", "专注了 3 轮，中途停了 1 次", "今天记的备忘：买牛奶 和鸡蛋"]);
  });

  it("keeps what the log saw today even after the lists dropped it", () => {
    const event = (kind: string, text: string, itemId: string) => ({ at: 0, day: "2026-11-16", kind, source: "chat", text, before: null, itemId });
    const lines = todayLines({ agenda: [], notes: [] }, {
      events: [
        event("reminder_done", "交周报", "r1"), event("reminder_deleted", "交周报", "r1"),
        event("reminder_done", "买菜", "r2"), event("reminder_undone", "买菜", "r2"),
        event("note_added", "草稿", "n1"), event("note_edited", "定稿", "n1"),
        event("note_added", "随手记", "n2"), event("note_deleted", "随手记", "n2"),
      ],
      counts: [],
    }, NOW);
    expect(lines).toEqual(["完成了提醒：交周报", "专注了 0 轮", "今天记的备忘：定稿"]);
  });

  it("tells what Claude Code finished today", () => {
    const turn = { at: 0, day: "2026-11-16", kind: "agent_turn_done", source: "agent", text: "ai-pet", before: null, itemId: null };
    expect(todayLines({ agenda: [], notes: [] }, { events: [turn], counts: [] }, NOW)).toContain("今天让 Claude Code 干完了 1 轮活：ai-pet 1 轮");
  });
});

describe("tool calls", () => {
  const reminder = (text: string, remindAt: number, extra: object = {}) => ({ kind: "reminder", item: { id: expect.any(String), text, remindAt, repeat: null, trimmed: false, onceOnly: false, ...extra } });
  const read = (args: unknown) => readReminderCall(args, NOW, makeId);
  const remindAt = (args: unknown) => { const result = read(args); return result.kind === "reminder" ? result.item.remindAt : null; };

  it("turns a reminder request into a reminder", () => {
    expect(read({ text: "开会", remind_at: "2026-11-16 15:00" })).toEqual(reminder("开会", at(16, 15)));
  });

  it("reads times with seconds or a T", () => {
    expect(remindAt({ text: "开会", remind_at: "2026-11-16 15:00:00" })).toBe(at(16, 15));
    expect(remindAt({ text: "交周报", remind_at: "2026-11-17T09:30" })).toBe(at(17, 9, 30));
  });

  it("turns a repeating request into a repeating reminder, whatever day the model picked", () => {
    const repeat = (args: unknown) => { const result = read(args); return result.kind === "reminder" ? result.item.repeat : undefined; };
    expect(repeat({ text: "点外卖", remind_at: "2026-11-16 11:00", repeat: "workdays" })).toBe("workdays");
    expect(repeat({ text: "吃药", remind_at: "2026-11-17 08:00", repeat: "daily" })).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(repeat({ text: "交周报", remind_at: "2026-11-20 17:00", repeat: "5" })).toEqual([5]);
    // A repeating reminder takes only the time of day, so a date already gone still counts.
    expect(read({ text: "早会", remind_at: "2026-11-10 09:00", repeat: "workdays" }).kind).toBe("reminder");
  });

  it("sets an unsupported rule as a one-off reminder and says so", () => {
    expect(read({ text: "交房租", remind_at: "2026-12-01 09:00", repeat: "monthly" })).toEqual(reminder("交房租", at(31, 9), { onceOnly: true }));
  });

  it("keeps a reminder without a time, or with a time already gone, as a note, with the reason", () => {
    expect(read({ text: "买牛奶" })).toEqual({ kind: "note", note: { text: "买牛奶", trimmed: false, fallback: "no-time" } });
    expect(read({ text: "交周报", remind_at: "2026-11-16 09:00" })).toEqual({ kind: "note", note: { text: "交周报", trimmed: false, fallback: "past" } });
    expect(read({ text: "开会", remind_at: "2026-02-30 15:00" })).toEqual({ kind: "note", note: { text: "开会", trimmed: false, fallback: "no-time" } });
  });

  it("cuts overlong text to the limit and marks it", () => {
    expect(read({ text: "长".repeat(80), remind_at: "2026-11-16 15:00" })).toMatchObject({ item: { text: "长".repeat(60), trimmed: true } });
    expect(readNoteCall({ text: "记".repeat(600) })).toEqual({ text: "记".repeat(500), trimmed: true });
  });

  it("says what it could not read", () => {
    expect(read({ text: "" })).toEqual({ kind: "failed", reason: "没看懂要提醒什么" });
    expect(read("not an object")).toEqual({ kind: "failed", reason: "没看懂要提醒什么" });
    expect(readNoteCall({ text: " " })).toBeNull();
    expect(readNoteCall({ text: "  WiFi：abc123\n密码在背面  " })).toEqual({ text: "WiFi：abc123\n密码在背面", trimmed: false });
  });
});

describe("confirmation", () => {
  it("speaks for the model when it only set a reminder", () => {
    expect(reminderConfirmation({ id: "a", text: "开会", remindAt: at(16, 15) }, NOW)).toBe("好，15:00 提醒你：开会");
    expect(reminderConfirmation({ id: "b", text: "开会", remindAt: at(17, 9) }, NOW)).toBe("好，明天 09:00 提醒你：开会");
    expect(reminderConfirmation({ id: "c", text: "点外卖", remindAt: at(16, 11), repeat: "workdays" }, NOW)).toBe("好，以后工作日 11:00 都提醒你：点外卖");
  });
});
