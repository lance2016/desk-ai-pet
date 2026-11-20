import { minutesOf, type QuietPreferences } from "../preferences/QuietPreferences";
import { dateKey } from "../worklog/WorkLog";

/** Good night comes this long before quiet hours start. */
const EVENING_LEAD_MINUTES = 30;
/** Good morning is only said this long after quiet hours end; opening the app at 9 pm is not the start of a day. */
const MORNING_WINDOW_MINUTES = 4 * 60;
const MINUTES_PER_DAY = 24 * 60;

export type GreetingKind = "morning" | "evening";
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
export function greetingDay(now: number, morningTime: string): string {
  return dateKey(now - minutesOf(morningTime) * 60_000);
}

/**
 * Which greeting `now` is the time for, if any; whether it was already given is
 * not looked at. Good morning: in the few hours after its configured time, or
 * after quiet hours end if they cover that time. Good night: in the half hour
 * before quiet hours. Configured times still apply when the quiet-hours switch
 * is off.
 */
export function greetingDue(now: number, hours: QuietHours, morningTime = hours.end): GreetingKind | null {
  const minute = minuteOfDay(now);
  const scheduledMorning = minutesOf(morningTime);
  const morning = hours.enabled && within(scheduledMorning, minutesOf(hours.start), minutesOf(hours.end))
    ? minutesOf(hours.end)
    : scheduledMorning;
  const night = minutesOf(hours.start);
  const evening = wrap(night - EVENING_LEAD_MINUTES);
  if (within(minute, evening, night)) return "evening";
  const morningEnds = within(wrap(morning + MORNING_WINDOW_MINUTES), morning, evening) ? wrap(morning + MORNING_WINDOW_MINUTES) : evening;
  return within(minute, morning, morningEnds) ? "morning" : null;
}
