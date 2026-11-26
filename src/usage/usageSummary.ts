import type { IconName } from "../ui/icons";
import { addDays, dateKey, type WorkLogData } from "../worklog/WorkLog";
import { PET_ROWS, USAGE_GROUPS, USAGE_ROWS, type UsageRow } from "./usageRows";

export const USAGE_RANGES = [7, 30] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];
/** Days the page reads: the longest range and the one before it, to compare with. */
export const USAGE_READ_DAYS = 60;
const HOURS = 24;
const WEEKDAYS = 7;

export interface UsageLine { id: string; label: string; icon: IconName; count: number; previous: number; daily: readonly number[] }
/** `weekday`: 0 is Monday, 6 Sunday. */
export interface UsageDay { day: string; count: number; weekday: number }
export interface UsageSummary {
  range: UsageRange;
  uses: { count: number; previous: number };
  activeDays: { count: number; previous: number };
  top: UsageLine | null;
  greetings: { said: number; answered: number; previousSaid: number; previousAnswered: number };
  agentTurns: number;
  /** Counting began before the previous range did, so comparing with it means something. */
  comparable: boolean;
  /** Oldest first, today last; only the feature in focus when there is one. */
  days: readonly UsageDay[];
  /** Uses by weekday (Monday first) and hour; only events still kept in full have the time. */
  heat: readonly (readonly number[])[];
  groups: readonly { title: string; lines: readonly UsageLine[] }[];
  /** The first day a use was counted, or null before any. */
  since: string | null;
}

interface Tally { day: string; kind: string; count: number; at: number | null }

const weekdayOf = (day: string) => (new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))).getDay() + 6) % WEEKDAYS;
const total = (tallies: readonly Tally[]) => tallies.reduce((sum, tally) => sum + tally.count, 0);

/** Adds up the work log for the last `range` days, today included, and the `range` days before them. */
export function summarizeUsage(log: WorkLogData, now: number, range: UsageRange, focus: string | null = null): UsageSummary {
  const days = Array.from({ length: range }, (_, index) => dateKey(addDays(now, index - range + 1)));
  const from = days[0];
  const previousFrom = dateKey(addDays(now, -2 * range + 1));
  const rowOf = new Map(USAGE_ROWS.flatMap((row) => row.kinds.map((kind) => [kind, row] as const)));
  const all: Tally[] = [
    ...log.events.map((event) => ({ day: event.day, kind: event.kind, count: 1, at: event.at })),
    ...log.counts.map((count) => ({ ...count, at: null })),
  ].filter((tally) => rowOf.has(tally.kind));
  const current = all.filter((tally) => tally.day >= from);
  const previous = all.filter((tally) => tally.day >= previousFrom && tally.day < from);
  const ofRow = (row: UsageRow) => (tally: Tally) => rowOf.get(tally.kind) === row;
  const byUser = (tally: Tally) => rowOf.get(tally.kind)?.byPet !== true;

  const lineOf = (row: UsageRow): UsageLine => {
    const own = current.filter(ofRow(row));
    return {
      id: row.id, label: row.label, icon: row.icon, count: total(own), previous: total(previous.filter(ofRow(row))),
      daily: days.map((day) => total(own.filter((tally) => tally.day === day))),
    };
  };
  const groups = USAGE_GROUPS.map((group) => ({ title: group.title, lines: group.rows.map(lineOf) }));
  const lines = groups.flatMap((group) => group.lines);
  const [greeting, agent] = PET_ROWS.map(lineOf);
  const reply = lines.find((line) => line.id === "greeting_reply");

  const focused = USAGE_ROWS.find((row) => row.id === focus && row.byPet !== true);
  const charted = current.filter(focused ? ofRow(focused) : byUser);
  const activeIn = (tallies: readonly Tally[]) => new Set(tallies.filter(byUser).filter((tally) => tally.count > 0).map((tally) => tally.day)).size;
  const top = lines.reduce<UsageLine | null>((best, line) => (line.count > (best?.count ?? 0) ? line : best), null);
  const since = all.filter((tally) => tally.kind.startsWith("use_")).map((tally) => tally.day).sort()[0] ?? null;

  return {
    range,
    uses: { count: total(current.filter(byUser)), previous: total(previous.filter(byUser)) },
    activeDays: { count: activeIn(current), previous: activeIn(previous) },
    top,
    greetings: { said: greeting.count, answered: reply?.count ?? 0, previousSaid: greeting.previous, previousAnswered: reply?.previous ?? 0 },
    agentTurns: agent.count,
    comparable: since !== null && since <= previousFrom,
    days: days.map((day) => ({ day, weekday: weekdayOf(day), count: total(charted.filter((tally) => tally.day === day)) })),
    heat: Array.from({ length: WEEKDAYS }, (_, weekday) => Array.from({ length: HOURS }, (_, hour) =>
      charted.filter((tally) => tally.at !== null && weekdayOf(tally.day) === weekday && new Date(tally.at).getHours() === hour).length)),
    groups,
    since,
  };
}

/** "↑ 12%", "↓ 8%", "持平", or "新" when there was nothing before. */
export function changeText(count: number, previous: number): string {
  if (previous === 0) return count > 0 ? "新" : "持平";
  const percent = Math.round(((count - previous) / previous) * 100);
  if (percent === 0) return "持平";
  return percent > 0 ? `↑ ${percent}%` : `↓ ${-percent}%`;
}
