import { z } from "zod";

/** Finished focus rounds per local day, for the morning and evening greetings. Shared by every character. */
const KEY = "ai-pet:focus-log:v1";
/** Days kept; older ones are dropped when a round is recorded. */
export const FOCUS_LOG_DAYS = 14;
const DAY_MS = 24 * 60 * 60_000;
const schema = z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number().int().min(0));
export type FocusLog = z.infer<typeof schema>;

const pad = (value: number) => String(value).padStart(2, "0");

/** Local date such as "2026-11-16". */
export function dateKey(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function focusRounds(log: FocusLog, day: number): number {
  return log[dateKey(day)] ?? 0;
}

export function loadFocusLog(storage: Storage = window.localStorage): FocusLog {
  try {
    const raw = storage.getItem(KEY);
    return raw ? schema.parse(JSON.parse(raw)) : {};
  } catch (error) {
    console.warn("Ignoring invalid focus log", error);
    return {};
  }
}

export function recordFocusRound(now: number, storage: Storage = window.localStorage): void {
  const today = dateKey(now);
  const oldest = dateKey(now - FOCUS_LOG_DAYS * DAY_MS);
  const kept: FocusLog = Object.fromEntries(Object.entries(loadFocusLog(storage)).filter(([day]) => day > oldest));
  storage.setItem(KEY, JSON.stringify({ ...kept, [today]: (kept[today] ?? 0) + 1 }));
}
