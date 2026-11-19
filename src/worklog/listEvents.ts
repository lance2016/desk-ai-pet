import { isDone, isStale, itemSummary, type AgendaItem } from "../agenda/AgendaStore";
import { clip } from "../agenda/chatTools";
import { sameRepeat } from "../agenda/Repeat";
import type { Fact } from "../facts/FactStore";
import type { Note } from "../notes/NoteStore";
import { EVENT_TEXT_CHARS, type NewWorkEvent, type WorkKind } from "./WorkLog";

/** Kept as one line, short enough to store. */
const line = (text: string) => clip(text.replace(/\s+/g, " ").trim(), EVENT_TEXT_CHARS);
const event = (kind: WorkKind, text: string, itemId: string, before: string | null = null): NewWorkEvent => ({ kind, text: line(text), before: before === null ? null : line(before), itemId });

/**
 * What was done to the reminders between two readings of the list. Adding,
 * changing and deleting keep the reminder's time with its text ("今天 15:00 · 开会");
 * a change keeps what it was before. Housekeeping is left out: being shown or
 * put off, finished ones dropped to make room, and old shown ones ticked off as stale.
 */
export function agendaEvents(before: readonly AgendaItem[], after: readonly AgendaItem[], now: number): NewWorkEvent[] {
  const earlier = new Map(before.map((item) => [item.id, item]));
  const later = new Set(after.map((item) => item.id));
  const changed = after.flatMap((item) => {
    const old = earlier.get(item.id);
    if (!old) return [event("reminder_added", itemSummary(item, now), item.id)];
    const edited = old.text !== item.text || old.remindAt !== item.remindAt || !sameRepeat(old.repeat, item.repeat);
    const ticked = item.doneAt !== null && item.doneAt !== old.doneAt && !isStale(old, now);
    const unticked = item.doneAt === null && old.doneAt !== null;
    return [
      ...(edited ? [event("reminder_edited", itemSummary(item, now), item.id, itemSummary(old, now))] : []),
      ...(ticked ? [event("reminder_done", item.text, item.id)] : []),
      ...(unticked ? [event("reminder_undone", item.text, item.id)] : []),
    ];
  });
  const removed = before.filter((item) => !later.has(item.id) && !isDone(item, now)).map((item) => event("reminder_deleted", itemSummary(item, now), item.id));
  return [...changed, ...removed];
}

/**
 * What was done to the notes. A deleted note keeps its text, a changed one what
 * it said before. A note pushed out to make room for a new one is not counted as deleted.
 */
export function noteEvents(before: readonly Note[], after: readonly Note[]): NewWorkEvent[] {
  const earlier = new Map(before.map((note) => [note.id, note]));
  const later = new Set(after.map((note) => note.id));
  const changed = after.flatMap((note) => {
    const old = earlier.get(note.id);
    if (!old) return [event("note_added", note.text, note.id)];
    return old.text === note.text ? [] : [event("note_edited", note.text, note.id, old.text)];
  });
  const added = changed.some((item) => item.kind === "note_added");
  const removed = added ? [] : before.filter((note) => !later.has(note.id)).map((note) => event("note_deleted", note.text, note.id));
  return [...changed, ...removed];
}

/** What was done to the facts about the user. A changed or deleted fact keeps what it said before. */
export function factEvents(before: readonly Fact[], after: readonly Fact[]): NewWorkEvent[] {
  const earlier = new Map(before.map((fact) => [fact.id, fact]));
  const later = new Set(after.map((fact) => fact.id));
  const changed = after.flatMap((fact) => {
    const old = earlier.get(fact.id);
    if (!old) return [event("fact_added", fact.text, fact.id)];
    return old.text === fact.text ? [] : [event("fact_edited", fact.text, fact.id, old.text)];
  });
  return [...changed, ...before.filter((fact) => !later.has(fact.id)).map((fact) => event("fact_deleted", fact.text, fact.id))];
}
