import type { WorkLogData } from "./WorkLog";

/** One day as the log tells it, after undoing what was undone the same day. */
export interface DayRecap {
  day: string;
  /** Reminders ticked off and not unticked again, by id, with their text when ticked. */
  remindersDone: Map<string, string>;
  /** Notes written or changed and not deleted afterwards, by id, with their latest text. */
  notesWritten: Map<string, string>;
  /** Reminders ticked off, also on folded days whose texts are gone. */
  doneCount: number;
  focusRounds: number;
  focusStopped: number;
}

/** What `log` says about `day`. */
export function dayRecap(log: WorkLogData, day: string): DayRecap {
  const remindersDone = new Map<string, string>();
  const notesWritten = new Map<string, string>();
  let focusRounds = 0;
  let focusStopped = 0;
  for (const { day: on, kind, text, itemId } of log.events) {
    if (on !== day) continue;
    if (kind === "focus_completed") focusRounds += 1;
    else if (kind === "focus_stopped") focusStopped += 1;
    if (itemId === null) continue;
    if (kind === "reminder_done") remindersDone.set(itemId, text);
    else if (kind === "reminder_undone") remindersDone.delete(itemId);
    else if (kind === "note_added" || kind === "note_edited") notesWritten.set(itemId, text);
    else if (kind === "note_deleted") notesWritten.delete(itemId);
  }
  const counted = (kind: string) => log.counts.filter((count) => count.day === day && count.kind === kind).reduce((sum, count) => sum + count.count, 0);
  return {
    day,
    remindersDone,
    notesWritten,
    doneCount: remindersDone.size + counted("reminder_done"),
    focusRounds: focusRounds + counted("focus_completed"),
    focusStopped: focusStopped + counted("focus_stopped"),
  };
}

/** Whether the day has anything worth telling. */
export function hasNews(recap: DayRecap): boolean {
  return recap.doneCount > 0 || recap.notesWritten.size > 0 || recap.focusRounds > 0;
}

/** The latest day in `log` before `today` with anything worth telling. */
export function lastActiveDay(log: WorkLogData, today: string): DayRecap | null {
  const days = [...new Set([...log.events.map((event) => event.day), ...log.counts.map((count) => count.day)])].filter((day) => day < today).sort().reverse();
  for (const day of days) {
    const recap = dayRecap(log, day);
    if (hasNews(recap)) return recap;
  }
  return null;
}
