import { z } from "zod";
import { isWorkday, type HolidayCalendar } from "./Workdays";

/**
 * When a reminder comes back: "workdays" follows China's official working
 * days; numbers are weekdays, 0 = Sunday, and all seven mean every day.
 */
export const repeatSchema = z.union([
  z.literal("workdays"),
  z.array(z.number().int().min(0).max(6)).min(1).max(7).transform((days) => [...new Set(days)].sort((a, b) => a - b)),
]);
export type Repeat = z.infer<typeof repeatSchema>;

export const EVERY_DAY: Repeat = [0, 1, 2, 3, 4, 5, 6];
/** How far to look for the next or last occurrence; longer than any holiday break. */
const SEARCH_DAYS = 40;
const WEEKDAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];
/** Monday first, the way weeks are read in China. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function sameRepeat(a: Repeat | null, b: Repeat | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function occursOn(repeat: Repeat, day: Date, calendar: HolidayCalendar): boolean {
  return repeat === "workdays" ? isWorkday(calendar, day) : repeat.includes(day.getDay());
}

/** `clock`'s time of day on the day `offset` days from `from`. */
function atDayOffset(from: number, offset: number, clock: number): Date {
  const day = new Date(from);
  const time = new Date(clock);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + offset, time.getHours(), time.getMinutes());
}

/** Occurrences at `clock`'s time of day, from `from`'s day onwards (step 1) or backwards (step -1). */
function occurrences(repeat: Repeat, clock: number, from: number, step: 1 | -1, calendar: HolidayCalendar): number[] {
  const found: number[] = [];
  for (let index = 0; index < SEARCH_DAYS; index += 1) {
    const at = atDayOffset(from, index * step, clock);
    if (occursOn(repeat, at, calendar)) found.push(at.getTime());
  }
  return found;
}

/** The first time after `now` at `clock`'s time of day; where a new repeating reminder starts. */
export function firstOccurrence(repeat: Repeat, clock: number, now: number, calendar: HolidayCalendar): number {
  return occurrences(repeat, clock, now, 1, calendar).find((at) => at > now) ?? clock;
}

/**
 * The occurrence a reminder that started at `first` is on at `now`: the latest
 * one whose time has come. Today's counts only once its time has passed, so a
 * missed one stays due until today's comes. Null before the first.
 */
export function currentOccurrence(repeat: Repeat, first: number, now: number, calendar: HolidayCalendar): number | null {
  const latest = occurrences(repeat, first, now, -1, calendar).find((at) => at <= now);
  return latest !== undefined && latest >= first ? latest : null;
}

/** The first occurrence after `after`, not before `first`. */
export function nextOccurrence(repeat: Repeat, first: number, after: number, calendar: HolidayCalendar): number | null {
  return occurrences(repeat, first, after, 1, calendar).find((at) => at > after && at >= first) ?? null;
}

/** "工作日", "每天" or "每周一、三". */
export function repeatLabel(repeat: Repeat): string {
  if (repeat === "workdays") return "工作日";
  if (repeat.length === EVERY_DAY.length) return "每天";
  return `每周${WEEK_ORDER.filter((day) => repeat.includes(day)).map((day) => WEEKDAY_NAMES[day]).join("、")}`;
}

/** Reads the model's rule: "workdays", "daily", or weekdays like "1,3,5" with 7 for Sunday. Null when unreadable. */
export function parseRepeat(text: string): Repeat | null {
  const value = text.trim().toLowerCase();
  if (value === "workdays") return "workdays";
  if (value === "daily") return EVERY_DAY;
  if (!/^[1-7](\s*,\s*[1-7])*$/.test(value)) return null;
  return repeatSchema.parse(value.split(",").map((day) => Number(day) % 7));
}
