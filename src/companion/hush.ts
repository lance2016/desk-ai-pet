import { z } from "zod";
import { minutesOf } from "../preferences/QuietPreferences";

/** Until when the user asked the pet to keep to itself. Shared by every character. */
const KEY = "ai-pet:companion-hush:v1";
const schema = z.object({ until: z.number() });
/** Before this hour it is still last night: "别催我" said at 1 a.m. lasts until this morning, not the next one. */
const NIGHT_END_HOUR = 4;

/** When the pet speaks up again after being asked to keep quiet: the coming morning, at `morningTime` ("HH:MM"). */
export function nextMorning(now: number, morningTime: string): number {
  const morning = new Date(now);
  const minutes = minutesOf(morningTime);
  if (morning.getHours() >= NIGHT_END_HOUR) morning.setDate(morning.getDate() + 1);
  morning.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  // A morning time before NIGHT_END_HOUR may already be past tonight (03:30, asked at 03:45): then it is the next one.
  if (morning.getTime() <= now) morning.setDate(morning.getDate() + 1);
  return morning.getTime();
}

/** Until when the pet keeps to itself, or null when it may speak up. */
export function hushedUntil(now: number, storage: Storage = window.localStorage): number | null {
  try {
    const raw = storage.getItem(KEY);
    const until = raw ? schema.parse(JSON.parse(raw)).until : null;
    return until !== null && until > now ? until : null;
  } catch (error) {
    console.warn("Ignoring an invalid quiet time", error);
    return null;
  }
}

/** Keeps the pet to itself until `until`; null lets it speak up again. */
export function setHush(until: number | null, storage: Storage = window.localStorage): void {
  if (until === null) storage.removeItem(KEY);
  else storage.setItem(KEY, JSON.stringify({ until }));
}
