import { describe, expect, it } from "vitest";
import type { AgendaItem } from "../agenda/AgendaStore";
import type { Note } from "../notes/NoteStore";
import type { Fact } from "../facts/FactStore";
import { agendaEvents, factEvents, noteEvents } from "./listEvents";

const NOW = new Date(2026, 10, 16, 14, 0).getTime();
const DAY = 86_400_000;

const reminder = (overrides: Partial<AgendaItem>): AgendaItem => ({ id: "r1", text: "开会", remindAt: NOW + 3_600_000, repeat: null, createdAt: 0, doneAt: null, remindedAt: null, ...overrides });
const note = (overrides: Partial<Note>): Note => ({ id: "n1", text: "WiFi 密码", pinned: false, createdAt: 0, updatedAt: 0, ...overrides });
const kinds = (events: Array<{ kind: string }>) => events.map((event) => event.kind);

describe("reminder events", () => {
  it("tells adding, ticking off, unticking, editing and deleting apart", () => {
    const before = [reminder({}), reminder({ id: "r2", text: "交周报" })];
    expect(agendaEvents([], before, NOW)).toEqual([
      { kind: "reminder_added", text: "今天 15:00 · 开会", before: null, itemId: "r1" },
      { kind: "reminder_added", text: "今天 15:00 · 交周报", before: null, itemId: "r2" },
    ]);
    expect(kinds(agendaEvents(before, [reminder({ doneAt: NOW }), before[1]], NOW))).toEqual(["reminder_done"]);
    expect(kinds(agendaEvents([reminder({ doneAt: NOW })], [reminder({})], NOW))).toEqual(["reminder_undone"]);
    expect(agendaEvents(before, [reminder({ text: "周会", remindAt: NOW + 7_200_000 }), before[1]], NOW)).toEqual([{ kind: "reminder_edited", text: "今天 16:00 · 周会", before: "今天 15:00 · 开会", itemId: "r1" }]);
    expect(kinds(agendaEvents(before, [reminder({ repeat: "workdays" }), before[1]], NOW))).toEqual(["reminder_edited"]);
    expect(agendaEvents(before, [before[0]], NOW)).toEqual([{ kind: "reminder_deleted", text: "今天 15:00 · 交周报", before: null, itemId: "r2" }]);
  });

  it("leaves out housekeeping and bookkeeping", () => {
    // Shown, snoozed: not something the user did to the reminder.
    expect(agendaEvents([reminder({})], [reminder({ remindedAt: NOW, snoozedUntil: NOW + 600_000 })], NOW)).toEqual([]);
    // A finished one dropped to make room.
    expect(agendaEvents([reminder({ doneAt: NOW - DAY })], [], NOW)).toEqual([]);
    // A long-past shown one ticked off as stale.
    const stale = reminder({ remindAt: NOW - 5 * DAY, remindedAt: NOW - 5 * DAY });
    expect(agendaEvents([stale], [{ ...stale, doneAt: NOW }], NOW)).toEqual([]);
  });

  it("counts each ticked occurrence of a repeating reminder", () => {
    const daily = reminder({ repeat: [0, 1, 2, 3, 4, 5, 6], doneAt: NOW - DAY });
    expect(kinds(agendaEvents([daily], [{ ...daily, doneAt: NOW }], NOW))).toEqual(["reminder_done"]);
  });
});

describe("note events", () => {
  it("tells adding, editing and deleting apart, on one line", () => {
    expect(noteEvents([], [note({ text: "地址：\n上海" })])).toEqual([{ kind: "note_added", text: "地址： 上海", before: null, itemId: "n1" }]);
    expect(noteEvents([note({})], [note({ text: "新密码" })])).toEqual([{ kind: "note_edited", text: "新密码", before: "WiFi 密码", itemId: "n1" }]);
    expect(noteEvents([note({})], [note({ updatedAt: NOW, pinned: true })])).toEqual([]);
    expect(noteEvents([note({})], [])).toEqual([{ kind: "note_deleted", text: "WiFi 密码", before: null, itemId: "n1" }]);
  });

  it("does not count a note pushed out by a new one as deleted", () => {
    expect(kinds(noteEvents([note({})], [note({ id: "n2", text: "新的" })]))).toEqual(["note_added"]);
  });

  it("keeps long text short", () => {
    expect(noteEvents([], [note({ text: "长".repeat(800) })])[0].text).toHaveLength(500);
  });
});

describe("fact events", () => {
  const fact = (overrides: Partial<Fact>): Fact => ({ id: "f1", text: "住在深圳", source: "chat", at: 0, ...overrides });

  it("tells adding, editing and deleting apart, keeping what it said before", () => {
    expect(factEvents([], [fact({})])).toEqual([{ kind: "fact_added", text: "住在深圳", before: null, itemId: "f1" }]);
    expect(factEvents([fact({})], [fact({ text: "住在上海" })])).toEqual([{ kind: "fact_edited", text: "住在上海", before: "住在深圳", itemId: "f1" }]);
    expect(factEvents([fact({})], [fact({ source: "user", at: NOW })])).toEqual([]);
    expect(factEvents([fact({})], [])).toEqual([{ kind: "fact_deleted", text: "住在深圳", before: null, itemId: "f1" }]);
  });
});
