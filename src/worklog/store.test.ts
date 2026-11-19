import { afterEach, describe, expect, it, vi } from "vitest";
import { worklogPlatform } from "../platform/worklog";
import { createMemoryStorage } from "../testing/fixtures";
import { addAgendaItem, removeAgendaItem } from "../agenda/AgendaStore";
import { editNote } from "../notes/NoteStore";
import { changeNotes, changeReminders, keepNote, readWorkLog, recordWork, tidyWorkLog } from "./store";

const NOW = new Date(2026, 11, 2, 9, 0).getTime();

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("work log store", () => {
  it("brings in the old focus counts once, then folds days past 30 into counts", async () => {
    const addCounts = vi.spyOn(worklogPlatform, "addCounts").mockResolvedValue();
    const compact = vi.spyOn(worklogPlatform, "compact").mockResolvedValue();
    const storage = createMemoryStorage({ "ai-pet:focus-log:v1": JSON.stringify({ "2026-11-30": 3, "2026-12-01": 0 }) });
    await tidyWorkLog(NOW, storage);
    await tidyWorkLog(NOW, storage);
    expect(addCounts).toHaveBeenCalledTimes(1);
    expect(addCounts).toHaveBeenCalledWith([{ day: "2026-11-30", kind: "focus_completed", count: 3 }]);
    expect(storage.getItem("ai-pet:focus-log:v1")).toBeNull();
    expect(compact).toHaveBeenLastCalledWith("2026-11-02");
  });

  it("keeps the old focus counts when they could not be brought in", async () => {
    vi.spyOn(worklogPlatform, "addCounts").mockRejectedValue(new Error("Work log is unavailable"));
    const storage = createMemoryStorage({ "ai-pet:focus-log:v1": JSON.stringify({ "2026-11-30": 3 }) });
    await expect(tidyWorkLog(NOW, storage)).rejects.toThrow();
    expect(storage.getItem("ai-pet:focus-log:v1")).not.toBeNull();
  });

  it("drops an unreadable old focus log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const addCounts = vi.spyOn(worklogPlatform, "addCounts").mockResolvedValue();
    vi.spyOn(worklogPlatform, "compact").mockResolvedValue();
    const storage = createMemoryStorage({ "ai-pet:focus-log:v1": "{broken" });
    await tidyWorkLog(NOW, storage);
    expect(addCounts).toHaveBeenCalledWith([]);
    expect(storage.getItem("ai-pet:focus-log:v1")).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("stamps events with the time and the local day, and carries on after a failed write", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const append = vi.spyOn(worklogPlatform, "append").mockRejectedValueOnce(new Error("busy")).mockResolvedValue();
    await recordWork([{ kind: "note_added", text: "a", before: null, itemId: "n1" }, { kind: "focus_completed", text: "", before: null, itemId: null }], "user", NOW);
    expect(append).toHaveBeenCalledTimes(2);
    expect(append).toHaveBeenLastCalledWith({ kind: "focus_completed", source: "user", text: "", before: null, itemId: null, at: NOW, day: "2026-12-02" });
  });

  it("writes down who changed the lists, and what an item said before", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const append = vi.spyOn(worklogPlatform, "append").mockResolvedValue();
    const storage = createMemoryStorage();
    const saved = keepNote("WiFi 密码 1234", "chat", storage);
    changeNotes((notes) => editNote(notes, saved.id, "WiFi 密码 5678", NOW), "user", storage);
    changeReminders((items) => addAgendaItem(items, { id: "r1", text: "开会", remindAt: NOW + 3_600_000 }, NOW), "chat", storage);
    changeReminders((items) => removeAgendaItem(items, "r1"), "user", storage);
    await vi.waitFor(() => expect(append).toHaveBeenCalledTimes(4));
    expect(append.mock.calls.map(([event]) => [event.kind, event.source, event.text, event.before])).toEqual([
      ["note_added", "chat", "WiFi 密码 1234", null],
      ["note_edited", "user", "WiFi 密码 5678", "WiFi 密码 1234"],
      ["reminder_added", "chat", "今天 10:00 · 开会", null],
      ["reminder_deleted", "user", "今天 10:00 · 开会", null],
    ]);
  });

  it("refuses a malformed read", async () => {
    vi.spyOn(worklogPlatform, "read").mockResolvedValue({ events: [{ day: "nope" }], counts: [] });
    await expect(readWorkLog(NOW, NOW)).rejects.toThrow();
  });
});
