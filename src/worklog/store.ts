import { z } from "zod";
import { loadAgenda, updateAgenda, type AgendaItem } from "../agenda/AgendaStore";
import { loadNotes, saveNote, updateNotes, type Note } from "../notes/NoteStore";
import { worklogPlatform } from "../platform/worklog";
import { agendaEvents, noteEvents } from "./listEvents";
import { addDays, dateKey, KEEP_DAYS, workLogSchema, type NewWorkEvent, type WorkCount, type WorkLogData, type WorkSource } from "./WorkLog";

/** Finished focus rounds per day, kept before the work log existed. Brought in once, then removed. */
const OLD_FOCUS_KEY = "ai-pet:focus-log:v1";
const oldFocusSchema = z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number().int().min(0));

/** Writes events in order, all at `now`. A failure is logged; the pet carries on. */
export async function recordWork(events: readonly NewWorkEvent[], source: WorkSource, now = Date.now()): Promise<void> {
  for (const item of events) {
    try {
      await worklogPlatform.append({ ...item, source, at: now, day: dateKey(now) });
    } catch (error) {
      console.warn("Could not write to the work log", error);
    }
  }
}

/**
 * Changes the reminders and writes what was done into the work log. Every change
 * the user or a chat tool makes goes through here; housekeeping (marking them
 * shown, ticking off stale ones) may use `updateAgenda` directly.
 */
export function changeReminders(change: (items: AgendaItem[]) => AgendaItem[], source: WorkSource, storage: Storage = window.localStorage): AgendaItem[] {
  const before = loadAgenda(storage);
  const after = updateAgenda(change, storage);
  void recordWork(agendaEvents(before, after, Date.now()), source);
  return after;
}

/** Changes the notes and writes what was done into the work log. */
export function changeNotes(change: (notes: Note[]) => Note[], source: WorkSource, storage: Storage = window.localStorage): Note[] {
  const before = loadNotes(storage);
  const after = updateNotes(change, storage);
  void recordWork(noteEvents(before, after), source);
  return after;
}

/** `saveNote`, written into the work log. */
export function keepNote(text: string, source: WorkSource, storage: Storage = window.localStorage): Note {
  const before = loadNotes(storage);
  const saved = saveNote(text, storage);
  void recordWork(noteEvents(before, loadNotes(storage)), source);
  return saved;
}

/** The log of the local days from `from` to `to`, both included. */
export async function readWorkLog(from: number, to: number): Promise<WorkLogData> {
  return workLogSchema.parse(await worklogPlatform.read(dateKey(from), dateKey(to)));
}

export async function exportWorkLog(): Promise<WorkLogData> {
  return workLogSchema.parse(await worklogPlatform.exportAll());
}

function oldFocusCounts(raw: string): WorkCount[] {
  try {
    return Object.entries(oldFocusSchema.parse(JSON.parse(raw))).filter(([, count]) => count > 0).map(([day, count]) => ({ day, kind: "focus_completed", count }));
  } catch (error) {
    console.warn("Dropping an unreadable old focus log", error);
    return [];
  }
}

/** Brings in the old focus counts once, then folds days older than `KEEP_DAYS` into counts. */
export async function tidyWorkLog(now: number, storage: Storage = window.localStorage): Promise<void> {
  const raw = storage.getItem(OLD_FOCUS_KEY);
  if (raw !== null) {
    await worklogPlatform.addCounts(oldFocusCounts(raw));
    storage.removeItem(OLD_FOCUS_KEY);
  }
  await worklogPlatform.compact(dateKey(addDays(now, -KEEP_DAYS)));
}
