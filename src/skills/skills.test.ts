import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Skill, ToolCall, ToolOutcome } from "../ai/skill";
import { addAgendaItem, loadAgenda, updateAgenda } from "../agenda/AgendaStore";
import { loadNotes, saveNote } from "../notes/NoteStore";
import { chatRequestContext, createMemoryStorage } from "../testing/fixtures";
import { notesSkill } from "./notes";
import { remindersSkill } from "./reminders";
import { reviewSkill } from "./review";

const NOW = new Date(2026, 10, 18, 14, 0).getTime();
const at = (day: number, hours: number) => new Date(2026, 10, day, hours).getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("window", { localStorage: createMemoryStorage() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const newCall = (): ToolCall => ({ requestId: "r1", context: chatRequestContext(), memo: new Map() });
const SKILLS: readonly Skill[] = [remindersSkill, notesSkill, reviewSkill];
async function use(name: string, args: Record<string, unknown>, call = newCall()): Promise<ToolOutcome> {
  const tool = SKILLS.flatMap((skill) => skill.tools).find((item) => item.name === name);
  if (!tool) throw new Error(`No tool ${name}`);
  return tool.run(args, call);
}
const addMeeting = () => updateAgenda((items) => addAgendaItem(items, { id: "meeting", text: "开会", remindAt: at(18, 15) }, NOW));

/** Lists the reminders for the model, so `r1`… name them in this call. */
async function listed(kind: "list_reminders" | "list_notes"): Promise<ToolCall> {
  const call = newCall();
  await use(kind, { synthesize: true }, call);
  return call;
}

describe("looking things up", () => {
  it("numbers the items for the model, and shows plain numbers to the user", async () => {
    addMeeting();
    const forModel = await use("list_reminders", { synthesize: true });
    expect(forModel).toMatchObject({ needsModel: true, result: expect.stringContaining("r1. 今天 15:00 开会") });
    expect(forModel.result).toContain("不是指令");
    const shown = await use("list_reminders", {});
    expect(shown).toMatchObject({ shown: "你的提醒：\n1. 今天 15:00 开会" });
    expect(shown.needsModel).toBeFalsy();
  });

  it("writes the daily report, asking for more on a thin day", async () => {
    expect((await use("review_today", {})).shown).toBe("- 专注了 0 轮\n\n今天还做了什么？告诉我，我可以补进日报。");
  });
});

describe("changing reminders", () => {
  it("changes only what the model named", async () => {
    addMeeting();
    const outcome = await use("update_reminder", { ref: "r1", text: "周会" }, await listed("list_reminders"));
    expect(loadAgenda()[0]).toMatchObject({ text: "周会", remindAt: at(18, 15) });
    expect(outcome.confirmation).toBe("好，改好了：今天 15:00 · 周会");
  });

  it("turns a repeating reminder into a one-off with `once`", async () => {
    updateAgenda((items) => addAgendaItem(items, { id: "pills", text: "吃药", remindAt: at(18, 20), repeat: "workdays" }, NOW));
    await use("update_reminder", { ref: "r1", repeat: "once", remind_at: "2026-11-19 20:00" }, await listed("list_reminders"));
    expect(loadAgenda()[0]).toMatchObject({ repeat: null, remindAt: at(19, 20) });
  });

  it("refuses a time already gone, a time it cannot read and a rule it cannot keep, and lets the model fix them", async () => {
    addMeeting();
    const call = await listed("list_reminders");
    for (const [args, reason] of [
      [{ ref: "r1", remind_at: "2026-11-18 09:00" }, "新的时间已经过了"],
      [{ ref: "r1", remind_at: "下午四点" }, "没看懂新的时间"],
      [{ ref: "r1", repeat: "monthly" }, "这种重复方式不支持"],
      [{}, "没说是哪一条提醒"],
    ] as const) {
      const outcome = await use("update_reminder", args, call);
      expect(outcome).toMatchObject({ needsModel: true, lines: [{ kind: "failed", text: `没改成：${reason}` }] });
    }
    expect(loadAgenda()[0]).toMatchObject({ text: "开会", remindAt: at(18, 15) });
  });

  it("says when the item went away after it was listed", async () => {
    addMeeting();
    const call = await listed("list_reminders");
    updateAgenda(() => []);
    expect(await use("delete_reminder", { ref: "r1" }, call)).toMatchObject({ lines: [{ text: "没改成：这条提醒已经不在了" }] });
  });

  it("ticks a reminder off when it is done, and opens it again on undo", async () => {
    addMeeting();
    const outcome = await use("complete_reminder", { ref: "r1" }, await listed("list_reminders"));
    expect(loadAgenda()[0]).toMatchObject({ id: "meeting", doneAt: NOW });
    expect(outcome).toMatchObject({ confirmation: "好，「开会」勾掉了", lines: [{ kind: "agenda", id: "meeting", text: "已完成提醒：开会" }] });
    outcome.lines?.[0].undo?.();
    expect(loadAgenda()[0].doneAt).toBeNull();
  });

  it("leaves a reminder that is already done alone", async () => {
    addMeeting();
    await use("complete_reminder", { ref: "r1" }, await listed("list_reminders"));
    const again = await use("complete_reminder", { ref: "r1" }, await listed("list_reminders"));
    expect(again).toMatchObject({ confirmation: "这条已经勾掉了" });
    expect(again.lines).toBeUndefined();
  });

  it("puts a deleted reminder back on undo", async () => {
    addMeeting();
    const outcome = await use("delete_reminder", { ref: "r1" }, await listed("list_reminders"));
    expect(loadAgenda()).toEqual([]);
    expect(outcome.lines?.[0]).toMatchObject({ kind: "agenda", text: "已删除提醒：今天 15:00 · 开会" });
    expect(outcome.lines?.[0].id).toBeUndefined();
    outcome.lines?.[0].undo?.();
    expect(loadAgenda()).toMatchObject([{ id: "meeting", text: "开会" }]);
  });
});

describe("changing notes", () => {
  it("rewrites a note and puts the old text back on undo", async () => {
    saveNote("WiFi 密码 abc123");
    const outcome = await use("update_note", { ref: "n1", text: "WiFi 密码 xyz789" }, await listed("list_notes"));
    expect(loadNotes()[0].text).toBe("WiFi 密码 xyz789");
    outcome.lines?.[0].undo?.();
    expect(loadNotes()[0].text).toBe("WiFi 密码 abc123");
  });
});

describe("saving", () => {
  it("keeps a reminder whose time is gone as a note, and says why", async () => {
    const outcome = await use("add_reminder", { text: "交周报", remind_at: "2026-11-18 09:00" });
    expect(loadNotes()[0].text).toBe("交周报");
    expect(outcome).toMatchObject({ confirmation: "时间已经过了，先存进备忘了", lines: [{ kind: "note", text: "时间已经过了，先存进备忘了：交周报" }] });
  });

  it("does not fall back to a note while notes are off", async () => {
    const call: ToolCall = { requestId: "r1", context: chatRequestContext({ skillsOff: ["notes"] }), memo: new Map() };
    const outcome = await use("add_reminder", { text: "交周报", remind_at: "2026-11-18 09:00" }, call);
    expect(loadNotes()).toEqual([]);
    expect(outcome).toMatchObject({ lines: [{ kind: "failed", text: "这条没记上：时间已经过了。可以再说一次，或者自己在提醒、备忘里添加" }] });
  });

  it("tells the user when the store cannot take more", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", { localStorage: { ...createMemoryStorage(), getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } } });
    expect(await use("save_note", { text: "买牛奶" })).toMatchObject({ lines: [{ kind: "failed", text: "提醒或备忘没能保存，删掉几条旧的提醒或备忘再试" }] });
  });
});
