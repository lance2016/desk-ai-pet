import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAgenda } from "../agenda/AgendaStore";
import { loadNotes } from "../notes/NoteStore";
import { petWindow } from "../platform/petWindow";
import { createMemoryStorage } from "../testing/fixtures";
import type { ActionResult } from "../types";
import { applyToolCalls, dispatchChatAction } from "./toolEffects";

const call = (name: string, args: object) => JSON.stringify({ name, arguments: JSON.stringify(args) });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 18, 21, 51));
  vi.stubGlobal("window", { localStorage: createMemoryStorage() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("chat tool effects", () => {
  it("confirms a reminder and a note from the local writes", () => {
    const result = applyToolCalls([
      call("add_reminder", { text: "开会", remind_at: "2026-11-19 09:00" }),
      call("save_note", { text: "买牛奶" }),
    ]);
    expect(loadAgenda()[0]).toMatchObject({ text: "开会", remindAt: new Date(2026, 10, 19, 9).getTime() });
    expect(loadNotes()[0]).toMatchObject({ text: "买牛奶" });
    expect(result.confirmation).toBe("好，明天 09:00 提醒你：开会。好，存进备忘了");
  });

  it("dispatches without waiting, then supplies words for a tool-only reply", async () => {
    let accept!: (result: ActionResult) => void;
    const schedule = vi.spyOn(petWindow, "requestChatAction")
      .mockReturnValue(new Promise<ActionResult>((resolve) => { accept = resolve; }));
    const action = dispatchChatAction("wooden_fish", "request-1");
    expect(schedule).toHaveBeenCalledExactlyOnceWith("wooden_fish", "request-1");
    accept({ accepted: true, actionId: "wooden_fish" });
    await expect(action).resolves.toEqual({ lines: [], confirmation: "好，来吧。" });
  });

  it("reports a rejected action without claiming that it played", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(petWindow, "requestChatAction").mockResolvedValue({ accepted: false, reason: "busy" });
    await expect(dispatchChatAction("wave", "request-2")).resolves.toMatchObject({
      lines: [{ kind: "failed", text: "宠物现在正忙，暂时做不了这个动作。" }],
    });
  });
});
