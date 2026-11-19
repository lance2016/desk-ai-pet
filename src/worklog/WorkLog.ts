import { z } from "zod";

/**
 * The work log: what happened each day, who did it, and what a changed or
 * deleted item said before, kept by the native side in SQLite
 * (`src-tauri/src/worklog.rs`). Structured events, never chat text. Events are
 * kept `KEEP_DAYS` days; older days keep only how many events of each kind they had.
 */

/** What the pet writes down. Readers skip kinds they do not know, so later versions can add more. */
export type WorkKind =
  | "reminder_added" | "reminder_done" | "reminder_undone" | "reminder_edited" | "reminder_deleted"
  | "note_added" | "note_edited" | "note_deleted"
  | "focus_completed" | "focus_stopped"
  | "fact_added" | "fact_edited" | "fact_deleted";

/** Who did it: the user by hand (panels, the pet's buttons, undo), or a tool in a chat reply. */
export type WorkSource = "user" | "chat";

export const KEEP_DAYS = 30;
/** Characters of an event's text, enough for a whole note. The native side refuses more than 1000. */
export const EVENT_TEXT_CHARS = 500;
/** No real log comes near this; the native side refuses more. */
const MAX_ROWS = 200_000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** As the native side checks it. */
const KIND = /^[a-z_]{1,32}$/;

export const workEventSchema = z.object({
  at: z.number().int(),
  day: z.string().regex(DAY),
  kind: z.string().regex(KIND),
  source: z.string().regex(KIND),
  text: z.string().max(EVENT_TEXT_CHARS),
  before: z.string().max(EVENT_TEXT_CHARS).nullable(),
  itemId: z.string().min(1).max(64).nullable(),
});
const workCountSchema = z.object({ day: z.string().regex(DAY), kind: z.string().regex(KIND), count: z.number().int().positive() });
export const workLogSchema = z.object({ events: z.array(workEventSchema).max(MAX_ROWS), counts: z.array(workCountSchema).max(MAX_ROWS) });

export type WorkEvent = z.infer<typeof workEventSchema>;
export type WorkCount = z.infer<typeof workCountSchema>;
export type WorkLogData = z.infer<typeof workLogSchema>;
/** An event as the pet notices it; the time, day and source are added when it is written. */
export interface NewWorkEvent { kind: WorkKind; text: string; before: string | null; itemId: string | null }

export const EMPTY_WORK_LOG: WorkLogData = { events: [], counts: [] };

const pad = (value: number) => String(value).padStart(2, "0");

/** Local date such as "2026-11-16". */
export function dateKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `at` moved by whole local days, keeping the time of day. */
export function addDays(at: number, days: number): number {
  const date = new Date(at);
  date.setDate(date.getDate() + days);
  return date.getTime();
}
