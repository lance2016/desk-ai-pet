import { describe, expect, it, vi } from "vitest";
import { addNote, saveNotes } from "../notes/NoteStore";
import { createMemoryStorage } from "../testing/fixtures";
import type { WorkLogData } from "../worklog/WorkLog";
import { backupFileName, createBackup, localData, parseBackup, replaceLocalData, restoreBackup, summarizeBackup } from "./Backup";

const PICTURE = { key: JSON.stringify(["girl-default", "happy"]), value: { image: "data:image/png;base64,AAAA", frames: 1, fps: 12, motion: "none" as const, motionSpeed: 1, motionStrength: 1, loop: false } };
const LOG: WorkLogData = { events: [{ at: 1, day: "2026-11-18", kind: "reminder_edited", source: "chat", text: "今天 16:00 · 开会", before: "今天 15:00 · 开会", itemId: "r1" }], counts: [{ day: "2026-10-01", kind: "focus_completed", count: 2 }] };
const EMPTY_LOG: WorkLogData = { events: [], counts: [] };
const REMINDER = { id: "r1", text: "开会", remindAt: 1_000, repeat: null, createdAt: 0, doneAt: null, remindedAt: null };

/** A work log kept in memory, as the native side keeps it. */
function memoryLog(initial = EMPTY_LOG, failing = false) {
  let current = initial;
  return {
    current: () => current,
    exportAll: async () => current,
    replace: async (log: WorkLogData) => { if (failing) throw new Error("locked"); current = log; },
  };
}

function sample(): Storage {
  const storage = createMemoryStorage({ "ai-pet:agenda:v1": JSON.stringify([REMINDER]), "other-app": "keep" });
  saveNotes(addNote([], { id: "n1", text: "WiFi 密码" }, 0), storage);
  return storage;
}

describe("Backup", () => {
  it("round-trips the app's data and leaves other keys out", () => {
    const backup = createBackup(localData(sample()), [PICTURE], LOG, 5);
    const parsed = parseBackup(JSON.stringify(backup));
    expect(Object.keys(parsed.local).sort()).toEqual(["ai-pet:agenda:v1", "ai-pet:notes:v1"]);
    expect(parsed.workLog).toEqual(LOG);
    expect(summarizeBackup(parsed)).toEqual({ exportedAt: 5, reminders: 1, notes: 1, pictures: 1, loggedDays: 2 });
  });

  it("reads a version 1 backup as one without a work log", () => {
    const { workLog: _, ...old } = { ...createBackup({}, [], LOG), version: 1 };
    expect(parseBackup(JSON.stringify(old)).workLog).toEqual(EMPTY_LOG);
  });

  it("rejects files that are not a backup", () => {
    expect(() => parseBackup("not json")).toThrow();
    expect(() => parseBackup(JSON.stringify({ format: "something-else" }))).toThrow();
    expect(() => parseBackup(JSON.stringify({ ...createBackup({}, [], EMPTY_LOG), local: { "evil-key": "x" } }))).toThrow();
  });

  it("replaces the app's keys and keeps everything else", async () => {
    const storage = createMemoryStorage({ "ai-pet:old:v1": "old", "other-app": "keep" });
    const replace = vi.fn(async () => {});
    const log = memoryLog();
    await restoreBackup(createBackup({ "ai-pet:notes:v1": "[]" }, [PICTURE], LOG), replace, log, storage);
    expect(localData(storage)).toEqual({ "ai-pet:notes:v1": "[]" });
    expect(log.current()).toEqual(LOG);
    expect(storage.getItem("other-app")).toBe("keep");
    expect(replace).toHaveBeenCalledWith([PICTURE]);
  });

  it("puts the old data back when the pictures cannot be written", async () => {
    const storage = createMemoryStorage({ "ai-pet:old:v1": "old" });
    const failing = async () => { throw new Error("disk full"); };
    const log = memoryLog(LOG);
    await expect(restoreBackup(createBackup({ "ai-pet:notes:v1": "[]" }, [], EMPTY_LOG), failing, log, storage)).rejects.toThrow("disk full");
    expect(localData(storage)).toEqual({ "ai-pet:old:v1": "old" });
    expect(log.current()).toEqual(LOG);
  });

  it("changes nothing when the work log cannot be replaced", async () => {
    const storage = createMemoryStorage({ "ai-pet:old:v1": "old" });
    const replace = vi.fn(async () => {});
    await expect(restoreBackup(createBackup({ "ai-pet:notes:v1": "[]" }, [PICTURE], LOG), replace, memoryLog(EMPTY_LOG, true), storage)).rejects.toThrow("locked");
    expect(localData(storage)).toEqual({ "ai-pet:old:v1": "old" });
    expect(replace).not.toHaveBeenCalled();
  });

  it("puts the old data back when a value cannot be written", () => {
    const storage = createMemoryStorage({ "ai-pet:old:v1": "old" });
    const setItem = storage.setItem.bind(storage);
    storage.setItem = (key, value) => { if (key === "ai-pet:big:v1") throw new Error("QuotaExceededError"); setItem(key, value); };
    expect(() => replaceLocalData({ "ai-pet:a:v1": "a", "ai-pet:big:v1": "x" }, storage)).toThrow("QuotaExceededError");
    expect(localData(storage)).toEqual({ "ai-pet:old:v1": "old" });
  });

  it("names the file after the day", () => {
    expect(backupFileName(new Date(2026, 10, 6, 9).getTime())).toBe("AI Pet 备份 2026-11-06.json");
  });
});
