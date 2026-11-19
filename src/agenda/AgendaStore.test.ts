import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import {
  addAgendaItem,
  archiveStale,
  AGENDA_LIMITS,
  dueReminders,
  editAgendaItem,
  formatReminderTime,
  fromTimeInput,
  isDone,
  itemSummary,
  leftoverReminders,
  moveToToday,
  loadAgenda,
  markReminded,
  removeAgendaItem,
  restoreAgendaItem,
  saveAgenda,
  timelessAgendaTexts,
  dropTimelessAgenda,
  setAgendaItemDone,
  shownAt,
  snoozeReminders,
  sortAgenda,
  toTimeInput,
  type AgendaItem,
} from "./AgendaStore";

const NOON = new Date(2026, 10, 16, 12, 0).getTime();
const MINUTE = 60_000;

function item(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return { id: "a", text: "开会", remindAt: NOON + 60 * MINUTE, repeat: null, createdAt: NOON, doneAt: null, remindedAt: null, ...overrides };
}

describe("agenda items", () => {
  it("adds a trimmed reminder", () => {
    const items = addAgendaItem([], { id: "x", text: "  开会  ", remindAt: NOON + 60 * MINUTE }, NOON);
    expect(items).toEqual([item({ id: "x", remindAt: NOON + 60 * MINUTE })]);
  });

  it("refuses empty or overlong text", () => {
    expect(() => addAgendaItem([], { id: "x", text: "  ", remindAt: NOON }, NOON)).toThrow();
    expect(() => addAgendaItem([], { id: "x", text: "字".repeat(AGENDA_LIMITS.text + 1), remindAt: NOON }, NOON)).toThrow();
  });

  it("drops the oldest items once the list is full", () => {
    const full = Array.from({ length: AGENDA_LIMITS.items }, (_, index) => item({ id: `i${index}`, createdAt: NOON - index }));
    const next = addAgendaItem(full, { id: "new", text: "新的", remindAt: NOON }, NOON);
    expect(next).toHaveLength(AGENDA_LIMITS.items);
    expect(next.some((entry) => entry.id === "new")).toBe(true);
    expect(next.some((entry) => entry.id === `i${AGENDA_LIMITS.items - 1}`)).toBe(false);
  });

  it("makes room with finished and past reminders before an old daily one", () => {
    const daily = item({ id: "pills", repeat: [0, 1, 2, 3, 4, 5, 6], createdAt: NOON - 200 * 24 * 60 * MINUTE });
    const past = item({ id: "past", remindAt: NOON - 60 * MINUTE, remindedAt: NOON - 60 * MINUTE, createdAt: NOON - MINUTE });
    const rest = Array.from({ length: AGENDA_LIMITS.items - 2 }, (_, index) => item({ id: `i${index}`, createdAt: NOON - index }));
    const next = addAgendaItem([daily, past, ...rest], { id: "new", text: "新的", remindAt: NOON + MINUTE }, NOON);
    expect(next.map((entry) => entry.id)).toContain("pills");
    expect(next.map((entry) => entry.id)).not.toContain("past");
  });

  it("counts a one-off shown days ago and never ticked as done", () => {
    const stale = item({ id: "stale", remindAt: NOON - 4 * 24 * 60 * MINUTE, remindedAt: NOON - 4 * 24 * 60 * MINUTE });
    const fresh = item({ id: "fresh", remindAt: NOON - 60 * MINUTE, remindedAt: NOON - 60 * MINUTE });
    const archived = archiveStale([stale, fresh], NOON);
    expect(archived.find((entry) => entry.id === "stale")?.doneAt).toBe(NOON);
    expect(archived.find((entry) => entry.id === "fresh")?.doneAt).toBeNull();
    expect(archiveStale([fresh], NOON)).toEqual([fresh]);
  });

  it("forgets items finished before today", () => {
    const yesterday = NOON - 24 * 60 * MINUTE;
    const items = [item({ id: "old", doneAt: yesterday }), item({ id: "today", doneAt: NOON - MINUTE }), item({ id: "open", createdAt: yesterday })];
    const next = addAgendaItem(items, { id: "x", text: "新的", remindAt: NOON }, NOON);
    expect(next.map((entry) => entry.id)).toEqual(["today", "open", "x"]);
  });

  it("marks done, undoes and removes without touching the original list", () => {
    const items = [item()];
    const done = setAgendaItemDone(items, "a", true, NOON);
    expect(done[0].doneAt).toBe(NOON);
    expect(items[0].doneAt).toBeNull();
    expect(setAgendaItemDone(done, "a", false, NOON)[0].doneAt).toBeNull();
    expect(removeAgendaItem(done, "a")).toEqual([]);
  });

  it("lists open items by time, then finished ones", () => {
    const items = [
      item({ id: "done", doneAt: NOON }),
      item({ id: "late", remindAt: NOON + 60 * MINUTE }),
      item({ id: "soon", remindAt: NOON + 30 * MINUTE }),
    ];
    expect(sortAgenda(items, NOON).map((entry) => entry.id)).toEqual(["soon", "late", "done"]);
  });
});

describe("reminders", () => {
  it("are due once their time has come, until reminded or done", () => {
    const items = [
      item({ id: "due", remindAt: NOON - MINUTE }),
      item({ id: "later", remindAt: NOON + MINUTE }),
      item({ id: "plain" }),
      item({ id: "done", remindAt: NOON - MINUTE, doneAt: NOON }),
      item({ id: "seen", remindAt: NOON - MINUTE, remindedAt: NOON }),
    ];
    expect(dueReminders(items, NOON).map((entry) => entry.id)).toEqual(["due"]);
    const reminded = markReminded(items, ["due"], NOON);
    expect(dueReminders(reminded, NOON)).toEqual([]);
  });

  it("come back once a snooze is over, until answered again", () => {
    const snoozed = snoozeReminders([item({ remindAt: NOON - MINUTE })], ["a"], NOON, NOON + 10 * MINUTE);
    expect(dueReminders(snoozed, NOON + 9 * MINUTE)).toEqual([]);
    expect(dueReminders(snoozed, NOON + 10 * MINUTE).map((entry) => entry.remindAt)).toEqual([NOON - MINUTE]);
    expect(dueReminders(markReminded(snoozed, ["a"], NOON + 11 * MINUTE), NOON + 12 * MINUTE)).toEqual([]);
    expect(dueReminders(setAgendaItemDone(snoozed, "a", true, NOON + 11 * MINUTE), NOON + 12 * MINUTE)).toEqual([]);
  });

  it("forget a snooze when the time is changed", () => {
    const snoozed = snoozeReminders([item({ remindAt: NOON - MINUTE })], ["a"], NOON, NOON + 10 * MINUTE);
    const moved = editAgendaItem(snoozed, "a", { text: "开会", remindAt: NOON + 60 * MINUTE }, NOON + MINUTE);
    expect(dueReminders(moved, NOON + 10 * MINUTE)).toEqual([]);
    expect(dueReminders(moved, NOON + 60 * MINUTE).map((entry) => entry.remindAt)).toEqual([NOON + 60 * MINUTE]);
  });
});

describe("reminder time", () => {
  it("names the day only when it is not today", () => {
    expect(formatReminderTime(NOON + 3 * 60 * MINUTE, NOON)).toBe("15:00");
    expect(formatReminderTime(NOON + 27 * 60 * MINUTE, NOON)).toBe("明天 15:00");
    expect(formatReminderTime(NOON + 4 * 24 * 60 * MINUTE, NOON)).toBe("11月20日 周五 12:00");
    expect(formatReminderTime(new Date(2027, 0, 3, 9, 0).getTime(), NOON)).toBe("2027年1月3日 周日 09:00");
  });
});

describe("plain to-dos saved before reminders needed a time", () => {
  const stored = () => createMemoryStorage({ "ai-pet:agenda:v1": JSON.stringify([
    item({ id: "timed" }),
    { ...item({ id: "open", text: "买牛奶" }), remindAt: null },
    { ...item({ id: "done", text: "倒垃圾", doneAt: NOON }), remindAt: null },
  ]) });

  it("are hidden from the reminders and handed over as note texts, unfinished ones only", () => {
    const storage = stored();
    expect(loadAgenda(storage).map((entry) => entry.id)).toEqual(["timed"]);
    expect(timelessAgendaTexts(storage)).toEqual(["买牛奶"]);
  });

  it("are forgotten once kept as notes", () => {
    const storage = stored();
    dropTimelessAgenda(storage);
    expect(timelessAgendaTexts(storage)).toEqual([]);
    expect(loadAgenda(storage).map((entry) => entry.id)).toEqual(["timed"]);
  });
});

describe("agenda storage", () => {
  it("saves and loads the list", () => {
    const storage = createMemoryStorage();
    saveAgenda([item()], storage);
    expect(loadAgenda(storage)).toEqual([item()]);
  });

  it("starts empty and ignores malformed data", () => {
    expect(loadAgenda(createMemoryStorage())).toEqual([]);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = createMemoryStorage({ "ai-pet:agenda:v1": "{" });
    expect(loadAgenda(broken)).toEqual([]);
    expect(broken.getItem("ai-pet:agenda:v1:broken")).toBe("{");
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it("keeps the readable items when one is broken", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = createMemoryStorage({ "ai-pet:agenda:v1": JSON.stringify([item({ id: "good" }), { id: "bad" }]) });
    expect(loadAgenda(storage).map((entry) => entry.id)).toEqual(["good"]);
    warning.mockRestore();
  });
});

describe("editing items", () => {
  it("changes the text and the reminder time", () => {
    const edited = editAgendaItem([item()], "a", { text: " 开周会 ", remindAt: NOON + 30 * MINUTE }, NOON);
    expect(edited[0]).toMatchObject({ text: "开周会", remindAt: NOON + 30 * MINUTE });
  });

  it("opens a finished one-off again when it is moved to a later time", () => {
    const done = item({ doneAt: NOON - MINUTE, remindAt: NOON - 60 * MINUTE });
    expect(editAgendaItem([done], "a", { text: "开会", remindAt: NOON + 60 * MINUTE }, NOON)[0].doneAt).toBeNull();
    expect(editAgendaItem([done], "a", { text: "开周会", remindAt: NOON - 60 * MINUTE }, NOON)[0].doneAt).toBe(NOON - MINUTE);
  });

  it("lets a moved reminder fire again, but keeps an unchanged one quiet", () => {
    const reminded = item({ remindAt: NOON, remindedAt: NOON });
    expect(editAgendaItem([reminded], "a", { text: "开会", remindAt: NOON + MINUTE }, NOON)[0].remindedAt).toBeNull();
    expect(editAgendaItem([reminded], "a", { text: "改个名", remindAt: NOON }, NOON)[0].remindedAt).toBe(NOON);
  });

  it("refuses empty text", () => {
    expect(() => editAgendaItem([item()], "a", { text: " ", remindAt: NOON }, NOON)).toThrow();
  });
});

describe("restoreAgendaItem", () => {
  it("puts a removed item back once", () => {
    const removed = item({ id: "b" });
    const restored = restoreAgendaItem([item()], removed);
    expect(restored.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(restoreAgendaItem(restored, removed)).toHaveLength(2);
  });
});

describe("itemSummary", () => {
  it("names the day and time", () => {
    expect(itemSummary({ text: "开会", remindAt: NOON + 3 * 60 * MINUTE }, NOON)).toBe("今天 15:00 · 开会");
    expect(itemSummary({ text: "交报告", remindAt: NOON + 24 * 60 * MINUTE }, NOON)).toBe("明天 12:00 · 交报告");
    expect(itemSummary({ text: "交报告", remindAt: NOON - 3 * 24 * 60 * MINUTE }, NOON)).toBe("11月13日 周五 12:00 · 交报告");
  });

  it("names the rule and the time of a repeating reminder", () => {
    expect(itemSummary({ text: "点外卖", remindAt: NOON - 60 * MINUTE, repeat: "workdays" }, NOON)).toBe("工作日 11:00 · 点外卖");
  });
});

describe("time inputs", () => {
  it("round-trips a local time through a datetime-local value", () => {
    expect(toTimeInput(NOON + 5 * MINUTE)).toBe("2026-11-16T12:05");
    expect(fromTimeInput("2026-11-16T12:05")).toBe(NOON + 5 * MINUTE);
  });

  it("reads an empty or broken value as no reminder", () => {
    expect(fromTimeInput("")).toBeNull();
    expect(fromTimeInput("2026-02-30T12:00")).toBeNull();
  });
});

describe("repeating reminders", () => {
  /** 2026-11-16 is a Monday. */
  const at = (month: number, day: number, hours: number, minutes = 0) => new Date(2026, month - 1, day, hours, minutes).getTime();
  const takeout = (overrides: Partial<AgendaItem> = {}) => item({ id: "t", text: "点外卖", remindAt: at(11, 16, 11), repeat: "workdays", createdAt: at(11, 16, 10), ...overrides });

  it("start at the next working day's time", () => {
    const add = (now: number) => addAgendaItem([], { id: "t", text: "点外卖", remindAt: at(11, 18, 11), repeat: "workdays" }, now)[0];
    expect(add(at(11, 16, 10)).remindAt).toBe(at(11, 16, 11));
    expect(add(at(11, 16, 12)).remindAt).toBe(at(11, 17, 11));
    expect(add(at(11, 20, 12)).remindAt).toBe(at(11, 23, 11)); // Friday afternoon: next Monday
    expect(add(at(9, 30, 12)).remindAt).toBe(at(10, 8, 11)); // over the National Day holiday
  });

  it("come back every working day until reminded that day", () => {
    const items = [takeout()];
    expect(dueReminders(items, at(11, 16, 10, 59))).toEqual([]);
    expect(dueReminders(items, at(11, 16, 11, 30))).toEqual([{ ...takeout(), remindAt: at(11, 16, 11) }]);
    const reminded = markReminded(items, ["t"], at(11, 16, 11, 31));
    expect(dueReminders(reminded, at(11, 16, 18))).toEqual([]);
    expect(dueReminders(reminded, at(11, 17, 11)).map((entry) => entry.remindAt)).toEqual([at(11, 17, 11)]);
  });

  it("let a snooze run out with its own day", () => {
    const snoozed = snoozeReminders([takeout()], ["t"], at(11, 16, 11, 1), at(11, 16, 11, 11));
    expect(dueReminders(snoozed, at(11, 16, 11, 11)).map((entry) => entry.remindAt)).toEqual([at(11, 16, 11)]);
    const answered = markReminded(snoozed, ["t"], at(11, 16, 11, 12));
    expect(dueReminders(answered, at(11, 17, 11)).map((entry) => entry.remindAt)).toEqual([at(11, 17, 11)]);
    expect(dueReminders(answered, at(11, 17, 10))).toEqual([]);
  });

  it("skip holidays and ring on make-up working days", () => {
    const items = [takeout({ remindAt: at(9, 30, 11), remindedAt: at(9, 30, 11) })];
    expect(dueReminders(items, at(10, 1, 12))).toEqual([]);
    expect(shownAt(items[0], at(10, 1, 12))).toBe(at(10, 8, 11));
    expect(dueReminders(items, at(10, 10, 12)).map((entry) => entry.remindAt)).toEqual([at(10, 10, 11)]); // a Saturday
  });

  it("do not pile up missed days, and keep the last missed one until the next one comes", () => {
    const items = [takeout()];
    expect(dueReminders(items, at(11, 19, 12)).map((entry) => entry.remindAt)).toEqual([at(11, 19, 11)]);
    expect(dueReminders(items, at(11, 23, 9)).map((entry) => entry.remindAt)).toEqual([at(11, 20, 11)]); // Monday morning: Friday's, over the weekend
    expect(dueReminders(items, at(11, 23, 11)).map((entry) => entry.remindAt)).toEqual([at(11, 23, 11)]);
  });

  it("stay due past midnight when the pet stayed quiet", () => {
    const pills = takeout({ remindAt: at(11, 16, 23, 30), repeat: [0, 1, 2, 3, 4, 5, 6] });
    expect(dueReminders([pills], at(11, 17, 0, 30)).map((entry) => entry.remindAt)).toEqual([at(11, 16, 23, 30)]);
    expect(dueReminders([pills], at(11, 17, 8)).map((entry) => entry.remindAt)).toEqual([at(11, 16, 23, 30)]);
    const reminded = markReminded([pills], ["t"], at(11, 17, 8));
    expect(dueReminders(reminded, at(11, 17, 12))).toEqual([]);
    expect(dueReminders(reminded, at(11, 17, 23, 30))).toHaveLength(1);
  });

  it("leave today's occurrence open when a missed one is ticked off", () => {
    const daily = takeout({ remindAt: at(11, 16, 22), repeat: [0, 1, 2, 3, 4, 5, 6] });
    const done = setAgendaItemDone([daily], "t", true, at(11, 17, 10))[0];
    expect(done.doneAt).toBe(at(11, 16, 22));
    expect(dueReminders([done], at(11, 17, 10))).toEqual([]);
    expect(isDone(done, at(11, 17, 10))).toBe(false);
    expect(shownAt(done, at(11, 17, 10))).toBe(at(11, 17, 22));
    expect(dueReminders([done], at(11, 17, 22, 1))).toHaveLength(1);
  });

  it("count done for the day only", () => {
    const done = setAgendaItemDone([takeout()], "t", true, at(11, 16, 9))[0];
    expect(isDone(done, at(11, 16, 12))).toBe(true);
    expect(dueReminders([done], at(11, 16, 12))).toEqual([]);
    expect(shownAt(done, at(11, 16, 12))).toBe(at(11, 17, 11));
    expect(isDone(done, at(11, 17, 9))).toBe(false);
    expect(dueReminders([done], at(11, 17, 11, 5))).toHaveLength(1);
  });

  it("show the occurrence waiting for the user, else the next one", () => {
    expect(shownAt(takeout(), at(11, 16, 9))).toBe(at(11, 16, 11));
    expect(shownAt(takeout(), at(11, 16, 12))).toBe(at(11, 16, 11));
    expect(shownAt(takeout({ remindedAt: at(11, 16, 11) }), at(11, 16, 12))).toBe(at(11, 17, 11));
  });

  it("are kept when finished on an earlier day", () => {
    const items = [takeout({ doneAt: at(11, 16, 12) })];
    const next = addAgendaItem(items, { id: "x", text: "新的", remindAt: at(11, 18, 15) }, at(11, 18, 9));
    expect(next.map((entry) => entry.id)).toEqual(["t", "x"]);
  });

  it("start over from now when the rule or the time changes", () => {
    const reminded = takeout({ remindedAt: at(11, 16, 11) });
    const renamed = editAgendaItem([reminded], "t", { text: "订午饭", remindAt: at(11, 16, 11), repeat: "workdays" }, at(11, 21, 12))[0];
    expect(renamed).toMatchObject({ text: "订午饭", remindAt: at(11, 16, 11), remindedAt: at(11, 16, 11) });
    const daily = editAgendaItem([reminded], "t", { text: "点外卖", remindAt: at(11, 16, 11), repeat: [0, 1, 2, 3, 4, 5, 6] }, at(11, 21, 12))[0];
    expect(daily).toMatchObject({ remindAt: at(11, 22, 11), remindedAt: null });
    expect(dueReminders([daily], at(11, 21, 12))).toEqual([]);
    const once = editAgendaItem([reminded], "t", { text: "点外卖", remindAt: at(11, 21, 18), repeat: null }, at(11, 21, 12))[0];
    expect(once).toMatchObject({ remindAt: at(11, 21, 18), repeat: null, remindedAt: null });
  });
});

describe("moving leftovers to today", () => {
  const NOW = new Date(2026, 10, 19, 9, 10, 30).getTime();
  const on = (day: number, hours: number, minutes = 0) => new Date(2026, 10, day, hours, minutes).getTime();
  const item = (overrides: Partial<AgendaItem>): AgendaItem => ({ id: "a", text: "交周报", remindAt: on(18, 15), repeat: null, createdAt: 0, doneAt: null, remindedAt: on(18, 15), ...overrides });

  it("finds one-off reminders from earlier days still open, but not stale or repeating ones", () => {
    const items = [
      item({ id: "yesterday" }),
      item({ id: "unseen", remindAt: on(10, 9), remindedAt: null }),
      item({ id: "stale", remindAt: on(10, 9) }),
      item({ id: "done", doneAt: on(18, 16) }),
      item({ id: "today", remindAt: on(19, 8) }),
      item({ id: "daily", repeat: [0, 1, 2, 3, 4, 5, 6] }),
    ];
    expect(leftoverReminders(items, NOW).map((entry) => entry.id)).toEqual(["yesterday", "unseen"]);
  });

  it("moves them to the same time today, or half an hour from now when that has passed, to fire again", () => {
    const moved = moveToToday([item({ id: "later" }), item({ id: "early", remindAt: on(18, 8) }), item({ id: "kept", remindAt: on(17, 10) })], ["later", "early"], NOW);
    expect(moved.map((entry) => [entry.id, entry.remindAt, entry.remindedAt])).toEqual([
      ["later", on(19, 15), null],
      ["early", on(19, 9, 41), null],
      ["kept", on(17, 10), on(18, 15)],
    ]);
  });
});
