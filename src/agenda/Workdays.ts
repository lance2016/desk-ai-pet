import { z } from "zod";
import bundledData from "chinese-days/dist/chinese-days.json";

/**
 * China's official working days: Monday to Friday, minus public holidays,
 * plus the weekend days worked in lieu. Holiday data ships with the app
 * (the `chinese-days` package) and missing years are downloaded later, so a
 * new year's schedule arrives without a new build.
 */
const KEY = "ai-pet:holidays:v1";
/** The next year's schedule is published around November; start looking in October. */
const NEXT_YEAR_FROM_MONTH = 9;

const dateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const yearSchema = z.object({
  /** Days off, including those that fall on a weekend. */
  holidays: z.record(dateKeySchema, z.string()),
  /** Weekend days that are working days. */
  workdays: z.record(dateKeySchema, z.string()),
});
const storedSchema = z.object({
  /** Downloaded years, by year ("2028"). They replace the bundled data of the same year. */
  years: z.record(z.string().regex(/^\d{4}$/), yearSchema),
  /** The day ("YYYY-MM-DD") missing years were last looked up, so it happens once a day. */
  checkedOn: z.string().nullable(),
});
type HolidayYear = z.infer<typeof yearSchema>;
type StoredHolidays = z.infer<typeof storedSchema>;
const EMPTY: StoredHolidays = { years: {}, checkedOn: null };

export interface HolidayCalendar {
  daysOff: ReadonlySet<string>;
  daysWorked: ReadonlySet<string>;
  /** Years with an official schedule; other years count Monday to Friday. */
  years: ReadonlySet<number>;
}

const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const yearOf = (key: string) => Number(key.slice(0, 4));

/** Splits all-years data into years, so a downloaded year can replace one whole. */
function byYear(data: HolidayYear): Map<number, HolidayYear> {
  const years = new Map<number, HolidayYear>();
  const yearFor = (key: string) => {
    const year = years.get(yearOf(key)) ?? { holidays: {}, workdays: {} };
    years.set(yearOf(key), year);
    return year;
  };
  for (const [key, name] of Object.entries(data.holidays)) yearFor(key).holidays[key] = name;
  for (const [key, name] of Object.entries(data.workdays)) yearFor(key).workdays[key] = name;
  return years;
}

const BUNDLED = byYear(yearSchema.parse(bundledData));

/** The bundled schedule with downloaded years laid over it. */
export function buildCalendar(downloaded: Record<string, HolidayYear> = {}): HolidayCalendar {
  const years = new Map(BUNDLED);
  for (const [year, data] of Object.entries(downloaded)) years.set(Number(year), data);
  const daysOff = new Set<string>();
  const daysWorked = new Set<string>();
  for (const data of years.values()) {
    Object.keys(data.holidays).forEach((key) => daysOff.add(key));
    Object.keys(data.workdays).forEach((key) => daysWorked.add(key));
  }
  return { daysOff, daysWorked, years: new Set(years.keys()) };
}

export function isWorkday(calendar: HolidayCalendar, day: Date): boolean {
  const key = dateKey(day);
  if (calendar.daysOff.has(key)) return false;
  if (calendar.daysWorked.has(key)) return true;
  const weekday = day.getDay();
  return weekday !== 0 && weekday !== 6;
}

/** The last year with an official schedule. */
export function lastCoveredYear(calendar: HolidayCalendar): number {
  return Math.max(...calendar.years);
}

function loadStored(storage: Storage): StoredHolidays {
  try {
    const raw = storage.getItem(KEY);
    return raw ? storedSchema.parse(JSON.parse(raw)) : EMPTY;
  } catch (error) {
    console.warn("Ignoring invalid holiday data", error);
    return EMPTY;
  }
}

let cached: { raw: string | null; calendar: HolidayCalendar } | null = null;

/** The calendar in use, rebuilt only when another window saved new years. */
export function holidayCalendar(): HolidayCalendar {
  // Unit tests run without a browser; they get the bundled data.
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  const raw = storage?.getItem(KEY) ?? null;
  if (cached?.raw !== raw) cached = { raw, calendar: buildCalendar(storage ? loadStored(storage).years : {}) };
  return cached.calendar;
}

/** Years to download now: this year if it is missing, and next year from October on. */
export function missingYears(calendar: HolidayCalendar, now: number): number[] {
  const date = new Date(now);
  const year = date.getFullYear();
  const wanted = date.getMonth() >= NEXT_YEAR_FROM_MONTH ? [year, year + 1] : [year];
  return wanted.filter((entry) => !calendar.years.has(entry));
}

/** Reads one downloaded year file; throws when it is not that year's schedule. */
export function parseHolidayYear(raw: string, year: number): HolidayYear {
  const data = yearSchema.parse(JSON.parse(raw));
  const keys = [...Object.keys(data.holidays), ...Object.keys(data.workdays)];
  if (keys.length === 0 || keys.some((key) => yearOf(key) !== year)) throw new Error(`Holiday data is not for ${year}`);
  return { holidays: data.holidays, workdays: data.workdays };
}

/**
 * Downloads the years the calendar is missing, at most once a day.
 * `download` gives a year's file, or null when it is not published yet.
 * A failed download is retried on the next call.
 */
export async function refreshHolidays(now: number, download: (year: number) => Promise<string | null>, storage: Storage = window.localStorage): Promise<void> {
  const stored = loadStored(storage);
  const today = dateKey(new Date(now));
  if (stored.checkedOn === today) return;
  const missing = missingYears(buildCalendar(stored.years), now);
  if (missing.length === 0) return;
  const years = { ...stored.years };
  for (const year of missing) {
    const raw = await download(year);
    if (raw !== null) years[String(year)] = parseHolidayYear(raw, year);
  }
  storage.setItem(KEY, JSON.stringify(storedSchema.parse({ years, checkedOn: today })));
}
