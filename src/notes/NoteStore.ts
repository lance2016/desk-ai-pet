import { z } from "zod";
import { readList } from "../storage/listStorage";

/**
 * Quick notes: snippets the user copies again and again (an address, a reply
 * they often send) and thoughts jotted down in passing. They belong to the
 * user, not to a character, so switching characters keeps them.
 */
const KEY = "ai-pet:notes:v1";

export const NOTE_LIMITS = {
  /** Characters of one note; must match `MAX_NOTE_CHARS` in `src-tauri/src/chat.rs`. */
  text: 500,
  /** Notes kept at most; the least recently changed unpinned ones go first. */
  items: 200,
  idLength: 64,
} as const;

const noteSchema = z.object({
  id: z.string().min(1).max(NOTE_LIMITS.idLength),
  text: z.string().trim().min(1).max(NOTE_LIMITS.text),
  pinned: z.boolean(),
  createdAt: z.number(),
  /** Last time the note was added or edited; recent ones come first. */
  updatedAt: z.number(),
});
const listSchema = z.array(noteSchema).max(NOTE_LIMITS.items);

export type Note = z.infer<typeof noteSchema>;

/** Adds a note at the front. Saving text that is already there brings that note forward instead. Throws on invalid text. */
export function addNote(notes: readonly Note[], input: { id: string; text: string }, now: number): Note[] {
  const added = noteSchema.parse({ id: input.id, text: input.text, pinned: false, createdAt: now, updatedAt: now });
  if (notes.some((note) => note.text === added.text)) return notes.map((note) => (note.text === added.text ? { ...note, updatedAt: now } : note));
  const kept = [added, ...notes];
  if (kept.length <= NOTE_LIMITS.items) return kept;
  const unpinned = kept.filter((note) => !note.pinned);
  if (unpinned.length === 0) throw new Error("Every note is pinned; unpin one to make room");
  const stalest = unpinned.reduce((oldest, note) => (note.updatedAt < oldest.updatedAt ? note : oldest));
  return kept.filter((note) => note.id !== stalest.id);
}

/** Changes a note's text. Throws on invalid text. */
export function editNote(notes: readonly Note[], id: string, text: string, now: number): Note[] {
  return notes.map((note) => (note.id === id ? noteSchema.parse({ ...note, text, updatedAt: now }) : note));
}

export function setNotePinned(notes: readonly Note[], id: string, pinned: boolean): Note[] {
  return notes.map((note) => (note.id === id ? { ...note, pinned } : note));
}

export function removeNote(notes: readonly Note[], id: string): Note[] {
  return notes.filter((note) => note.id !== id);
}

/** The note `addNote` pushed out to make room, if it had to. */
export function pushedOut(before: readonly Note[], after: readonly Note[]): Note | null {
  return before.find((note) => !after.some((kept) => kept.id === note.id)) ?? null;
}

/** Puts back a note that was just removed (undo). Does nothing if it is still there or the list is full. */
export function restoreNote(notes: readonly Note[], removed: Note): Note[] {
  if (notes.some((note) => note.id === removed.id) || notes.length >= NOTE_LIMITS.items) return [...notes];
  return [...notes, removed];
}

/** Pinned notes first, then the most recently changed. */
export function sortNotes(notes: readonly Note[]): Note[] {
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

/** Notes containing every word of `query`, ignoring case. An empty query matches all. */
export function searchNotes(notes: readonly Note[], query: string): Note[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...notes];
  return notes.filter((note) => {
    const text = note.text.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

const pad = (value: number) => String(value).padStart(2, "0");
const DAY_MS = 86_400_000;

function startOfDay(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** When a note was last changed: "14:03" today, "昨天", "11月16日", or "2025年3月2日" in another year. */
export function noteTime(at: number, now: number): string {
  const date = new Date(at);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (days === 1) return "昨天";
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return sameYear ? `${date.getMonth() + 1}月${date.getDate()}日` : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function loadNotes(storage: Storage = window.localStorage): Note[] {
  return readList(storage, KEY, noteSchema, NOTE_LIMITS.items);
}

export function saveNotes(notes: readonly Note[], storage: Storage = window.localStorage): void {
  storage.setItem(KEY, JSON.stringify(listSchema.parse(notes)));
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(KEY);
  channel.postMessage("changed");
  channel.close();
}

/** Reads, changes and saves the list in one step. */
export function updateNotes(change: (notes: Note[]) => Note[], storage: Storage = window.localStorage): Note[] {
  const next = change(loadNotes(storage));
  saveNotes(next, storage);
  return next;
}

/** Calls `listener` when another window changes the list. */
export function subscribeNotes(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(KEY);
  channel?.addEventListener("message", listener);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener("storage", onStorage); channel?.close(); };
}
