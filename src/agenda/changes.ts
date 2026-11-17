import type { AgendaItem } from "./AgendaStore";

/** What a saved list changing means to the pet: something was written down, a reminder was ticked off, or neither. */
export type ListChange = "added" | "done" | null;

/** Tells what happened between two readings of the reminders. Adding wins over ticking off in the same change. */
export function agendaChange(before: readonly AgendaItem[], after: readonly AgendaItem[]): ListChange {
  const known = new Map(before.map((item) => [item.id, item]));
  if (after.some((item) => !known.has(item.id))) return "added";
  // Ticking off sets `doneAt`; unticking clears it.
  return after.some((item) => item.doneAt !== null && item.doneAt !== known.get(item.id)?.doneAt) ? "done" : null;
}

/** Whether `after` holds an id that `before` did not, as when a note is added. */
export function hasNewId(before: ReadonlySet<string>, after: Iterable<string>): boolean {
  for (const id of after) if (!before.has(id)) return true;
  return false;
}
