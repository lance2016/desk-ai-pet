import { z } from "zod";
import { currentOccurrence, firstOccurrence, nextOccurrence, repeatLabel, repeatSchema, sameRepeat, type Repeat } from "./Repeat";
import { holidayCalendar, type HolidayCalendar } from "./Workdays";
import { readList } from "../storage/listStorage";

/**
 * Reminders: things to do at a set time. Every reminder has a time; anything
 * to keep without one is a note (see `src/notes/NoteStore.ts`). They belong to
 * the user, not to a character, so switching characters keeps them.
 */
const KEY = "ai-pet:agenda:v1";

export const AGENDA_LIMITS = {
  /** Characters of one item. Items are short, like "3 点开会". */
  text: 60,
  /** Items kept at most; finished and long-past ones go first. */
  items: 100,
  /** A one-off reminder that was shown and is this many days past counts as done. */
  staleDays: 3,
  idLength: 64,
} as const;

const itemSchema = z.object({
  id: z.string().min(1).max(AGENDA_LIMITS.idLength),
  text: z.string().trim().min(1).max(AGENDA_LIMITS.text),
  /** Epoch milliseconds to remind the user at. For a repeating reminder, its first occurrence. */
  remindAt: z.number(),
  /** Null for a one-off reminder. Done and reminded then count per occurrence. */
  repeat: repeatSchema.nullable().default(null),
  createdAt: z.number(),
  doneAt: z.number().nullable(),
  /** When the pet reminded the user, so a reminder fires once. */
  remindedAt: z.number().nullable(),
  /** "稍后提醒" on the reminder line: the occurrence on show comes up again at this time. */
  snoozedUntil: z.number().optional(),
});
const listSchema = z.array(itemSchema).max(AGENDA_LIMITS.items);
/** Saved data may still hold plain to-dos without a time, from before every reminder needed one. */
const storedItemSchema = itemSchema.extend({ remindAt: z.number().nullable() });
type StoredItem = z.infer<typeof storedItemSchema>;

export type AgendaItem = z.infer<typeof itemSchema>;
export interface NewAgendaItem {
  id: string;
  text: string;
  /** For a repeating reminder only the time of day counts; the first occurrence is worked out on adding. */
  remindAt: number;
  repeat?: Repeat | null;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** A leftover moved to today whose time has already passed comes up this long from now. */
const MOVED_LATE_MS = 30 * MINUTE_MS;

function startOfDay(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** Where a reminder starts: a one-off at its time, a repeating one at its first occurrence from now. */
function startOf(remindAt: number, repeat: Repeat | null, now: number, calendar: HolidayCalendar): number {
  return repeat === null ? remindAt : firstOccurrence(repeat, remindAt, now, calendar);
}

/** The occurrence a reminder is on: a one-off's own time, or a repeating one's current occurrence (null before its first). */
export function occurrenceAt(item: AgendaItem, now: number, calendar: HolidayCalendar = holidayCalendar()): number | null {
  return item.repeat === null ? item.remindAt : currentOccurrence(item.repeat, item.remindAt, now, calendar);
}

/**
 * Done for good, or, when it repeats, an occurrence on today or later was
 * ticked off. A repeating reminder's `doneAt` is the occurrence that was
 * finished, so it shows as done for the rest of that day.
 */
export function isDone(item: AgendaItem, now: number): boolean {
  if (item.doneAt === null) return false;
  return item.repeat === null || item.doneAt >= startOfDay(now);
}

/** Whether the occurrence at `occurrence` was ticked off. */
function occurrenceDone(item: AgendaItem, occurrence: number): boolean {
  return item.doneAt !== null && (item.repeat === null || item.doneAt >= occurrence);
}

/** A one-off reminder the pet showed long ago and nobody ticked off: it is over. */
export const isStale = (item: AgendaItem, now: number) => item.repeat === null && item.doneAt === null && item.remindedAt !== null && item.remindAt < now - AGENDA_LIMITS.staleDays * DAY_MS;

/**
 * Ticks off one-off reminders that were shown and are days past, so they stop
 * heading the list. Returns the same list when nothing changes.
 */
export function archiveStale(items: readonly AgendaItem[], now: number): readonly AgendaItem[] {
  if (!items.some((item) => isStale(item, now))) return items;
  return items.map((item) => (isStale(item, now) ? { ...item, doneAt: now } : item));
}

/** Which items go first when the list is full: finished ones, then past one-offs already shown, then the oldest. */
function evictionRank(item: AgendaItem, now: number): number {
  if (item.doneAt !== null && item.repeat === null) return 0;
  if (item.repeat === null && item.remindedAt !== null && item.remindAt < now) return 1;
  return 2;
}

/**
 * Adds an item. Throws on invalid text. One-off items finished before today
 * are forgotten. When the list is full, finished and past ones make room
 * before anything still to come, such as a daily reminder made months ago.
 */
export function addAgendaItem(items: readonly AgendaItem[], input: NewAgendaItem, now: number, calendar: HolidayCalendar = holidayCalendar()): AgendaItem[] {
  const repeat = input.repeat ?? null;
  const added = itemSchema.parse({ ...input, repeat, remindAt: startOf(input.remindAt, repeat, now, calendar), createdAt: now, doneAt: null, remindedAt: null });
  const today = startOfDay(now);
  const kept = [...archiveStale(items, now).filter((item) => item.repeat !== null || item.doneAt === null || item.doneAt >= today), added];
  const overflow = kept.length - AGENDA_LIMITS.items;
  if (overflow <= 0) return kept;
  const order = [...kept].filter((item) => item.id !== added.id).sort((a, b) => evictionRank(a, now) - evictionRank(b, now) || a.createdAt - b.createdAt);
  const dropped = new Set(order.slice(0, overflow).map((item) => item.id));
  return kept.filter((item) => !dropped.has(item.id));
}

/** A repeating reminder records the occurrence shown to the user, so ticking a missed one leaves today's open. */
export function setAgendaItemDone(items: readonly AgendaItem[], id: string, done: boolean, now: number, calendar: HolidayCalendar = holidayCalendar()): AgendaItem[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    if (!done) return { ...item, doneAt: null };
    return { ...item, doneAt: item.repeat === null ? now : shownAt(item, now, calendar) };
  });
}

export function removeAgendaItem(items: readonly AgendaItem[], id: string): AgendaItem[] {
  return items.filter((item) => item.id !== id);
}

/** What the user can change about an item. */
export interface AgendaEdit {
  text: string;
  /** For a repeating reminder only the time of day counts. */
  remindAt: number;
  repeat?: Repeat | null;
}

const clockOf = (at: number) => { const date = new Date(at); return date.getHours() * 60 + date.getMinutes(); };

/**
 * Changes an item's text and time. Throws on invalid text. A moved reminder
 * fires again at its new time; a changed repeating one starts over from now.
 */
export function editAgendaItem(items: readonly AgendaItem[], id: string, edit: AgendaEdit, now: number, calendar: HolidayCalendar = holidayCalendar()): AgendaItem[] {
  const repeat = edit.repeat ?? null;
  return items.map((item) => {
    if (item.id !== id) return item;
    const unchanged = sameRepeat(repeat, item.repeat) && (repeat === null ? edit.remindAt === item.remindAt : clockOf(edit.remindAt) === clockOf(item.remindAt));
    const remindAt = unchanged ? item.remindAt : startOf(edit.remindAt, repeat, now, calendar);
    // A finished one-off moved to a time still to come is a new task: it is open again.
    const reopened = !unchanged && repeat === null && remindAt > now;
    const timing = unchanged ? { remindAt, remindedAt: item.remindedAt } : { remindAt, remindedAt: null, snoozedUntil: undefined, ...(reopened ? { doneAt: null } : {}) };
    return itemSchema.parse({ ...item, text: edit.text, repeat, ...timing });
  });
}

/** One-off reminders from an earlier day, still open and not yet given up as stale: they can move to today. */
export function leftoverReminders(items: readonly AgendaItem[], now: number): AgendaItem[] {
  const today = startOfDay(now);
  return items.filter((item) => item.repeat === null && item.doneAt === null && item.remindAt < today && !isStale(item, now));
}

/**
 * Moves leftover reminders to the same time today, or `MOVED_LATE_MS` from now
 * when that time has passed. They fire again at the new time.
 */
export function moveToToday(items: readonly AgendaItem[], ids: readonly string[], now: number): AgendaItem[] {
  const moving = new Set(leftoverReminders(items, now).filter((item) => ids.includes(item.id)).map((item) => item.id));
  return items.reduce<AgendaItem[]>((list, item) => {
    if (!moving.has(item.id)) return list;
    const same = new Date(now);
    const was = new Date(item.remindAt);
    same.setHours(was.getHours(), was.getMinutes(), 0, 0);
    const remindAt = same.getTime() > now ? same.getTime() : Math.ceil((now + MOVED_LATE_MS) / MINUTE_MS) * MINUTE_MS;
    return editAgendaItem(list, item.id, { text: item.text, remindAt, repeat: null }, now);
  }, [...items]);
}

/** Puts back an item that was just removed (undo). Does nothing if it is still there or the list is full. */
export function restoreAgendaItem(items: readonly AgendaItem[], removed: AgendaItem): AgendaItem[] {
  if (items.some((item) => item.id === removed.id) || items.length >= AGENDA_LIMITS.items) return [...items];
  return [...items, removed];
}

/** The occurrence on show was put off, that time has come, and the user has not answered it since. */
function snoozeOver(item: AgendaItem, occurrence: number, now: number): boolean {
  const until = item.snoozedUntil;
  return until !== undefined && until > occurrence && until <= now && (item.remindedAt ?? 0) < until;
}

/**
 * Open reminders whose time has come and that the pet has not announced yet.
 * A repeating one comes with `remindAt` set to the occurrence that is due.
 */
export function dueReminders(items: readonly AgendaItem[], now: number, calendar: HolidayCalendar = holidayCalendar()): AgendaItem[] {
  return items.flatMap((item) => {
    const occurrence = occurrenceAt(item, now, calendar);
    if (occurrence === null || occurrence > now || occurrenceDone(item, occurrence)) return [];
    const announced = item.repeat === null ? item.remindedAt !== null : item.remindedAt !== null && item.remindedAt >= occurrence;
    return announced && !snoozeOver(item, occurrence, now) ? [] : [{ ...item, remindAt: occurrence }];
  });
}

/**
 * The time to show for a reminder: a one-off's own time; for a repeating one,
 * the occurrence still waiting for the user, else the next one to come.
 */
export function shownAt(item: AgendaItem, now: number, calendar: HolidayCalendar = holidayCalendar()): number {
  if (item.repeat === null) return item.remindAt;
  const due = dueReminders([item], now, calendar)[0];
  if (due) return due.remindAt;
  const after = item.doneAt !== null && item.doneAt > now ? item.doneAt : now;
  return nextOccurrence(item.repeat, item.remindAt, after, calendar) ?? item.remindAt;
}

export function markReminded(items: readonly AgendaItem[], ids: readonly string[], now: number): AgendaItem[] {
  return items.map((item) => (ids.includes(item.id) ? { ...item, remindedAt: now } : item));
}

/** Counts the reminders as seen now and has them come up again at `until`. */
export function snoozeReminders(items: readonly AgendaItem[], ids: readonly string[], now: number, until: number): AgendaItem[] {
  return items.map((item) => (ids.includes(item.id) ? { ...item, remindedAt: now, snoozedUntil: until } : item));
}

/** Open items by the time they show, then finished ones. */
export function sortAgenda(items: readonly AgendaItem[], now: number, calendar: HolidayCalendar = holidayCalendar()): AgendaItem[] {
  const open = items.filter((item) => !isDone(item, now)).sort((a, b) => shownAt(a, now, calendar) - shownAt(b, now, calendar));
  const done = items.filter((item) => isDone(item, now)).sort((a, b) => (a.doneAt ?? 0) - (b.doneAt ?? 0));
  return [...open, ...done];
}

function loadStored(storage: Storage): StoredItem[] {
  return readList(storage, KEY, storedItemSchema, AGENDA_LIMITS.items);
}

/** Reminders only; old plain to-dos are left for `timelessAgendaTexts` to move to notes. */
export function loadAgenda(storage: Storage = window.localStorage): AgendaItem[] {
  return loadStored(storage).filter((item): item is AgendaItem => item.remindAt !== null);
}

/** Unfinished plain to-dos saved before every reminder needed a time, to keep as notes. */
export function timelessAgendaTexts(storage: Storage = window.localStorage): string[] {
  return loadStored(storage).filter((item) => item.remindAt === null && item.doneAt === null).map((item) => item.text);
}

/** Forgets the plain to-dos once they are kept as notes. Does nothing when there are none. */
export function dropTimelessAgenda(storage: Storage = window.localStorage): void {
  const stored = loadStored(storage);
  if (stored.every((item) => item.remindAt !== null)) return;
  saveAgenda(loadAgenda(storage), storage);
}

export function saveAgenda(items: readonly AgendaItem[], storage: Storage = window.localStorage): void {
  storage.setItem(KEY, JSON.stringify(listSchema.parse(items)));
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(KEY);
  channel.postMessage("changed");
  channel.close();
}

/** Reads, changes and saves the list in one step. */
export function updateAgenda(change: (items: AgendaItem[]) => AgendaItem[], storage: Storage = window.localStorage): AgendaItem[] {
  const next = change(loadAgenda(storage));
  saveAgenda(next, storage);
  return next;
}

/** Calls `listener` when another window changes the list. */
export function subscribeAgenda(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(KEY);
  channel?.addEventListener("message", listener);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener("storage", onStorage); channel?.close(); };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A reminder time with its day always named: "今天 15:00", "明天 9:00", "11月20日 15:00". */
export function reminderLabel(at: number, now: number): string {
  const when = formatReminderTime(at, now);
  return startOfDay(at) === startOfDay(now) ? `今天 ${when}` : when;
}

/** "11:00". */
export function clockLabel(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** How an item was understood, e.g. "今天 15:00 · 开会" or "工作日 11:00 · 点外卖". */
export function itemSummary(item: Pick<NewAgendaItem, "text" | "remindAt" | "repeat">, now: number): string {
  const when = item.repeat ? `${repeatLabel(item.repeat)} ${clockLabel(item.remindAt)}` : reminderLabel(item.remindAt, now);
  return `${when} · ${item.text}`;
}

/** A time as an `<input type="datetime-local">` value: "2026-11-16T15:00". */
export function toTimeInput(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Reads a datetime-local value; empty or impossible dates mean no reminder. */
export function fromTimeInput(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hours, minutes] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);
  const exact = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && date.getHours() === hours && date.getMinutes() === minutes;
  return exact ? date.getTime() : null;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

/** "15:00" today, "明天 15:00" tomorrow, "11月20日 周五 15:00" otherwise, with the year when it is not this one. */
export function formatReminderTime(at: number, now: number): string {
  const date = new Date(at);
  const time = clockLabel(at);
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
  if (days === 0) return time;
  if (days === 1) return `明天 ${time}`;
  const year = date.getFullYear() === new Date(now).getFullYear() ? "" : `${date.getFullYear()}年`;
  return `${year}${date.getMonth() + 1}月${date.getDate()}日 周${WEEKDAYS[date.getDay()]} ${time}`;
}
