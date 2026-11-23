import { z } from "zod";
import type { ChatContext, ChatFacts } from "../ai/types";
import { ACTION_ID } from "../ai/skill";
import { NOTHING_OFF, type SwitchedOff } from "../preferences/SkillPreferences";
import { loadNotes, NOTE_LIMITS, sortNotes, type Note } from "../notes/NoteStore";
import { FOCUS_CONFIG } from "../behavior/FocusTimer";
import { agentWork, dayRecap } from "../worklog/recap";
import { dateKey, type WorkLogData } from "../worklog/WorkLog";
import { AGENDA_LIMITS, clockLabel, formatReminderTime, isDone, loadAgenda, reminderLabel, shownAt, sortAgenda, type AgendaItem, type NewAgendaItem } from "./AgendaStore";
import { parseRepeat, repeatLabel } from "./Repeat";

/** Longest reminder line in a lookup, so a long list stays small in the prompt. */
const REMINDER_LINE_LIMIT = 120;
/** Today's record for `review_today`: lines at most and characters per line. */
export const TODAY_LIMITS = { lines: 80, chars: 200 } as const;
/** A note in today's record is cut to this, so a long one does not crowd out the rest. */
const TODAY_NOTE_CHARS = 120;
/** A reminder set further in the past than this is kept as a note instead of firing at once. */
export const PAST_TOLERANCE_MS = 60_000;
/** Pet actions offered to the model at most. */
const MAX_ACTIONS = 30;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const addReminderSchema = z.object({ text: z.string(), remind_at: z.string().optional(), repeat: z.string().optional() });
const saveNoteSchema = z.object({ text: z.string() });

const pad = (value: number) => String(value).padStart(2, "0");

/** Local time as the prompt gives it: "2026-11-16 14:03 周一". */
export function localTimeText(now: number): string {
  const date = new Date(now);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())} 周${WEEKDAYS[date.getDay()]}`;
}

/** What the user keeps on this computer that the model may look up. */
export interface SavedItems {
  agenda: readonly AgendaItem[];
  notes: readonly Note[];
}

export function loadSavedItems(): SavedItems {
  return { agenda: loadAgenda(), notes: loadNotes() };
}

/**
 * What the model needs to know besides the conversation: the local time, the
 * actions it may pick, the line the pet opened the chat with when it spoke first (`opening`),
 * and the skills and tools the user turned off (`off`, from `loadSwitchedOff`).
 * What the user saved reaches it only when it looks it up.
 */
export function chatContext(now: number, actions: readonly string[], facts: ChatFacts, opening: string | null = null, off: SwitchedOff = NOTHING_OFF): ChatContext {
  const date = new Date(now);
  const offset = -date.getTimezoneOffset();
  const minutes = Math.abs(offset);
  const localIso = new Date(now + offset * 60_000).toISOString().slice(0, 19);
  return {
    now: localTimeText(now),
    timestamp: `${localIso}${offset < 0 ? "-" : "+"}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    actions: actions.filter((id) => ACTION_ID.test(id)).slice(0, MAX_ACTIONS),
    facts,
    ...(opening ? { opening } : {}),
    ...(off.skills.length > 0 ? { skillsOff: off.skills } : {}),
    ...(off.tools.length > 0 ? { toolsOff: off.tools } : {}),
  };
}

/**
 * Today's record for a daily review: reminders ticked off today, today's ones
 * still open, focus rounds, and notes written or changed today. The work log
 * keeps what the lists no longer show (a finished reminder deleted since, a
 * focus round stopped halfway); the lists cover what happened before the log
 * existed. The focus line is always there, so the model does not guess at it.
 */
export function todayLines({ agenda, notes }: SavedItems, log: WorkLogData, now: number): string[] {
  const start = new Date(now).setHours(0, 0, 0, 0);
  const end = new Date(now).setHours(24, 0, 0, 0);
  const recap = dayRecap(log, dateKey(now));
  const done = new Map([...recap.remindersDone, ...agenda.filter((item) => item.doneAt !== null && item.doneAt >= start && item.doneAt < end).map((item) => [item.id, item.text] as const)]);
  const open = agenda.filter((item) => !isDone(item, now) && shownAt(item, now) < end);
  const written = new Map([...recap.notesWritten, ...sortNotes(notes).filter((note) => note.updatedAt >= start).map((note) => [note.id, note.text] as const)]);
  const stopped = recap.focusStopped > 0 ? `，中途停了 ${recap.focusStopped} 次` : "";
  const agents = agentWork(recap);
  const lines = [
    ...[...done.values()].map((text) => `完成了提醒：${text}`),
    ...open.map((item) => `还没处理的提醒：${reminderLabel(shownAt(item, now), now)} ${item.text}`),
    `专注了 ${recap.focusRounds} 轮，每轮 ${FOCUS_CONFIG.focusMs / 60_000} 分钟${stopped}`,
    ...(agents ? [`今天${agents}`] : []),
    ...[...written.values()].map((text) => `今天记的备忘：${clip(text.replace(/\s+/g, " "), TODAY_NOTE_CHARS)}`),
  ];
  return lines.slice(0, TODAY_LIMITS.lines).map((line) => clip(line, TODAY_LIMITS.chars));
}

/**
 * Reminders as the model reads them: open ones by the time they show, then
 * finished one-offs. A repeating one shows its rule and its next time; one
 * ticked off today is not marked, since that mark would sit next to tomorrow's time.
 */
export function reminderLines(items: readonly AgendaItem[], now: number): string[] {
  return sortAgenda(items, now).map((item) => {
    const rule = item.repeat ? `（${repeatLabel(item.repeat)}）` : "";
    const done = item.repeat === null && item.doneAt !== null ? "（已完成）" : "";
    return clip(`${reminderLabel(shownAt(item, now), now)}${rule} ${item.text}${done}`, REMINDER_LINE_LIMIT);
  });
}

/** Local "YYYY-MM-DD HH:mm", also with seconds or a "T", to epoch milliseconds; null when it is not a real time. */
export function parseLocalTime(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hours, minutes] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);
  const exact = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && date.getHours() === hours && date.getMinutes() === minutes;
  return exact ? date.getTime() : null;
}

/** Cuts `text` to `limit` UTF-16 units without splitting a character. */
export function clip(text: string, limit: number): string {
  let kept = "";
  for (const char of text) {
    if (kept.length + char.length > limit) break;
    kept += char;
  }
  return kept;
}

/** A reminder the reply set. `trimmed`: its text was cut to fit; `onceOnly`: the model asked for a rule the app cannot repeat by. */
export interface ToolReminder extends NewAgendaItem {
  trimmed: boolean;
  onceOnly: boolean;
}

/** A note the reply saved. `fallback` says why a reminder became a note instead. */
export interface ToolNote {
  text: string;
  trimmed: boolean;
  fallback?: "past" | "no-time";
}

/** The text of a reminder or note, cut to `limit`; null when there is none. */
export function readText(raw: string, limit: number): { text: string; trimmed: boolean } | null {
  const text = raw.trim();
  if (!text) return null;
  const kept = clip(text, limit).trim();
  return { text: kept, trimmed: kept !== text };
}

/** What one `add_reminder` call asks for: a reminder, or a note when it has no usable time, or nothing it can keep. */
export type ReminderRequest =
  | { kind: "reminder"; item: ToolReminder }
  | { kind: "note"; note: ToolNote }
  | { kind: "failed"; reason: string };

/**
 * Reads one `add_reminder` call. Nothing is dropped silently: overlong text is cut and marked,
 * and a reminder without a usable time becomes a note with the reason.
 */
export function readReminderCall(args: unknown, now: number, makeId: () => string): ReminderRequest {
  const parsed = addReminderSchema.safeParse(args);
  const text = parsed.success ? readText(parsed.data.text, AGENDA_LIMITS.text) : null;
  if (!parsed.success || !text) return { kind: "failed", reason: "没看懂要提醒什么" };
  const { remind_at: when, repeat: rule } = parsed.data;
  const remindAt = when ? parseLocalTime(when) : null;
  const repeatRule = rule?.trim() ? rule : undefined;
  const repeat = repeatRule ? parseRepeat(repeatRule) : null;
  // A repeating reminder only takes the time of day, so a past date does not matter.
  if (remindAt !== null && (repeat !== null || remindAt >= now - PAST_TOLERANCE_MS)) {
    return { kind: "reminder", item: { id: makeId(), text: text.text, remindAt, repeat, trimmed: text.trimmed, onceOnly: repeatRule !== undefined && repeat === null } };
  }
  const note = readText(parsed.data.text, NOTE_LIMITS.text);
  return note ? { kind: "note", note: { ...note, fallback: remindAt === null ? "no-time" : "past" } } : { kind: "failed", reason: "没看懂要提醒什么" };
}

/** Reads one `save_note` call; null when it has no text. */
export function readNoteCall(args: unknown): ToolNote | null {
  const parsed = saveNoteSchema.safeParse(args);
  return parsed.success ? readText(parsed.data.text, NOTE_LIMITS.text) : null;
}

/** Why a reminder became a note, in words for the user. */
export const FALLBACK_REASONS: Record<NonNullable<ToolNote["fallback"]>, string> = {
  past: "时间已经过了，先存进备忘了",
  "no-time": "没听懂时间，先存进备忘了",
};

/** What the pet says for a reminder it set when the model said nothing. */
export function reminderConfirmation(item: NewAgendaItem, now: number): string {
  return item.repeat
    ? `好，以后${repeatLabel(item.repeat)} ${clockLabel(item.remindAt)} 都提醒你：${item.text}`
    : `好，${formatReminderTime(item.remindAt, now)} 提醒你：${item.text}`;
}
