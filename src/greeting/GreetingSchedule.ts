import { z } from "zod";
import { minutesOf, type QuietPreferences } from "../preferences/QuietPreferences";
import { dateKey } from "../worklog/WorkLog";

/** Which greetings were given on which day. Shared by every character, so switching does not greet again. */
const KEY = "ai-pet:greetings:v1";
/** Good night comes this long before quiet hours start. */
const EVENING_LEAD_MINUTES = 30;
/** Good morning is only said this long after quiet hours end; opening the app at 9 pm is not the start of a day. */
const MORNING_WINDOW_MINUTES = 4 * 60;
const MINUTES_PER_DAY = 24 * 60;

export type GreetingKind = "morning" | "evening";
const recordSchema = z.object({ morning: z.string().nullable(), evening: z.string().nullable() });
export type GreetingRecord = z.infer<typeof recordSchema>;
type QuietHours = QuietPreferences["quietHours"];

const wrap = (minutes: number) => ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
/** True when `minute` is in [from, to), on a clock face that wraps at midnight. */
const within = (minute: number, from: number, to: number) => (from <= to ? minute >= from && minute < to : minute >= from || minute < to);

/** When good night is said for quiet hours starting at `start` ("HH:MM"), as "HH:MM". */
export function eveningGreetingTime(start: string): string {
  const minute = wrap(minutesOf(start) - EVENING_LEAD_MINUTES);
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function minuteOfDay(now: number): number {
  const date = new Date(now);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * The day a greeting belongs to. A day starts when quiet hours end, so a night
 * that runs past midnight still belongs to the evening before.
 */
export function greetingDay(now: number, hours: QuietHours): string {
  return dateKey(now - minutesOf(hours.end) * 60_000);
}

/**
 * Which greeting is due at `now`, if any. Good morning: in the few hours after
 * quiet hours end. Good night: in the half hour before quiet hours.
 * The configured times are used even when quiet hours are switched off.
 */
export function greetingDue(now: number, hours: QuietHours, record: GreetingRecord): GreetingKind | null {
  const minute = minuteOfDay(now);
  const morning = minutesOf(hours.end);
  const night = minutesOf(hours.start);
  const evening = wrap(night - EVENING_LEAD_MINUTES);
  const day = greetingDay(now, hours);
  if (within(minute, evening, night)) return record.evening === day ? null : "evening";
  const morningEnds = within(wrap(morning + MORNING_WINDOW_MINUTES), morning, evening) ? wrap(morning + MORNING_WINDOW_MINUTES) : evening;
  if (within(minute, morning, morningEnds)) return record.morning === day ? null : "morning";
  return null;
}

export function loadGreetingRecord(storage: Storage = window.localStorage): GreetingRecord {
  try {
    const raw = storage.getItem(KEY);
    return raw ? recordSchema.parse(JSON.parse(raw)) : { morning: null, evening: null };
  } catch (error) {
    console.warn("Ignoring invalid greeting record", error);
    return { morning: null, evening: null };
  }
}

export function saveGreetingRecord(record: GreetingRecord, storage: Storage = window.localStorage): void {
  storage.setItem(KEY, JSON.stringify(recordSchema.parse(record)));
}
