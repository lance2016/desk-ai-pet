import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import {
  addNote,
  pushedOut,
  editNote,
  loadNotes,
  NOTE_LIMITS,
  noteTime,
  removeNote,
  restoreNote,
  saveNotes,
  searchNotes,
  setNotePinned,
  sortNotes,
  type Note,
} from "./NoteStore";

const NOON = new Date(2026, 10, 16, 12, 0).getTime();

function note(overrides: Partial<Note> = {}): Note {
  return { id: "a", text: "公司地址：深圳南山", pinned: false, createdAt: NOON, updatedAt: NOON, ...overrides };
}

describe("notes", () => {
  it("adds a trimmed note", () => {
    expect(addNote([], { id: "a", text: "  公司地址：深圳南山\n" }, NOON)).toEqual([note()]);
  });

  it("refuses empty or overlong text", () => {
    expect(() => addNote([], { id: "a", text: " \n " }, NOON)).toThrow();
    expect(() => addNote([], { id: "a", text: "字".repeat(NOTE_LIMITS.text + 1) }, NOON)).toThrow();
  });

  it("brings an existing note forward instead of saving the same text twice", () => {
    const notes = addNote([note()], { id: "b", text: "公司地址：深圳南山" }, NOON + 1);
    expect(notes).toEqual([note({ updatedAt: NOON + 1 })]);
  });

  it("drops the least recently changed unpinned note once the list is full", () => {
    const full = Array.from({ length: NOTE_LIMITS.items }, (_, index) => note({ id: `n${index}`, text: `第 ${index} 条`, updatedAt: NOON + index, pinned: index === 0 }));
    const notes = addNote(full, { id: "new", text: "新的一条" }, NOON + 1_000);
    expect(notes).toHaveLength(NOTE_LIMITS.items);
    expect(notes.some((item) => item.id === "n0")).toBe(true);
    expect(notes.some((item) => item.id === "n1")).toBe(false);
    expect(notes.some((item) => item.id === "new")).toBe(true);
  });

  it("edits text and counts the edit as a use", () => {
    expect(editNote([note()], "a", " 新地址 ", NOON + 5)).toEqual([note({ text: "新地址", updatedAt: NOON + 5 })]);
    expect(() => editNote([note()], "a", "  ", NOON)).toThrow();
  });

  it("pins, removes and restores without changing the input", () => {
    const original = [note()];
    expect(setNotePinned(original, "a", true)[0].pinned).toBe(true);
    expect(removeNote(original, "a")).toEqual([]);
    expect(restoreNote([], note())).toEqual([note()]);
    expect(restoreNote(original, note())).toEqual(original);
    expect(original).toEqual([note()]);
  });

  it("sorts pinned notes first, then the most recently used", () => {
    const sorted = sortNotes([
      note({ id: "old", updatedAt: NOON }),
      note({ id: "pin", updatedAt: NOON - 10, pinned: true }),
      note({ id: "new", updatedAt: NOON + 10 }),
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["pin", "new", "old"]);
  });

  it("finds notes containing every search word, ignoring case", () => {
    const notes = [note({ id: "a", text: "WiFi 密码 abc123" }), note({ id: "b", text: "家里 wifi" }), note({ id: "c", text: "快递单号" })];
    expect(searchNotes(notes, "wifi").map((item) => item.id)).toEqual(["a", "b"]);
    expect(searchNotes(notes, "wifi 密码").map((item) => item.id)).toEqual(["a"]);
    expect(searchNotes(notes, "  ")).toEqual(notes);
  });
});

describe("note time", () => {
  it("names the day the way a list of notes does", () => {
    expect(noteTime(new Date(2026, 10, 16, 9, 5).getTime(), NOON)).toBe("09:05");
    expect(noteTime(new Date(2026, 10, 15, 23, 0).getTime(), NOON)).toBe("昨天");
    expect(noteTime(new Date(2026, 9, 3).getTime(), NOON)).toBe("10月3日");
    expect(noteTime(new Date(2025, 2, 2).getTime(), NOON)).toBe("2025年3月2日");
  });
});

describe("note storage", () => {
  it("saves and loads the list", () => {
    const storage = createMemoryStorage();
    saveNotes([note()], storage);
    expect(loadNotes(storage)).toEqual([note()]);
  });

  it("ignores broken saved data", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:notes:v1", "{not json");
    expect(loadNotes(storage)).toEqual([]);
  });
});

describe("a full list", () => {
  it("tells which note was pushed out to make room", () => {
    const full = Array.from({ length: NOTE_LIMITS.items }, (_, index) => ({ id: `n${index}`, text: `备忘 ${index}`, pinned: false, createdAt: index, updatedAt: index + 1 }));
    const next = addNote(full, { id: "new", text: "新的" }, 10_000);
    expect(pushedOut(full, next)?.id).toBe("n0");
    expect(pushedOut(next, next)).toBeNull();
  });
});
