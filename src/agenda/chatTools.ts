import { z } from "zod";
import { loadNotes, NOTE_LIMITS, sortNotes, type Note } from "../notes/NoteStore";
import { FOCUS_CONFIG } from "../behavior/FocusTimer";
import { focusRounds, loadFocusLog, type FocusLog } from "../greeting/FocusLog";
import { AGENDA_LIMITS, clockLabel, formatReminderTime, isDone, loadAgenda, reminderLabel, shownAt, sortAgenda, type AgendaItem, type NewAgendaItem } from "./AgendaStore";
import { parseRepeat, repeatLabel } from "./Repeat";
import type { ChatContext } from "../platform/chat";

/** Tool names; must match `src-tauri/src/chat.rs`. Its lookups (`list_reminders`, `list_notes`, `review_today`) are answered there and never come here. */
const ADD_REMINDER_TOOL = "add_reminder";
const PLAY_ACTION_TOOL = "play_action";
const SAVE_NOTE_TOOL = "save_note";
/** Action ids the native side accepts. */
const ACTION_ID_PATTERN = /^[a-z0-9_]{1,40}$/;
/** Must match `MAX_TOOL_CALLS` in `src-tauri/src/chat.rs`. */
const MAX_CALLS_SHOWN = 8;
/** Longest reminder line handed over for a lookup; must match `MAX_REMINDER_LINE_CHARS` in `src-tauri/src/chat.rs`. */
const REMINDER_LINE_LIMIT = 120;
/** Today's record for `review_today`: lines at most and characters per line; must match `MAX_TODAY_LINES` and `MAX_TODAY_LINE_CHARS` in `src-tauri/src/chat.rs`. */
export const TODAY_LIMITS = { lines: 80, chars: 200 } as const;
/** A note in today's record is cut to this, so a long one does not crowd out the rest. */
const TODAY_NOTE_CHARS = 120;
/** A reminder set further in the past than this is kept as a note instead of firing at once. */
const PAST_TOLERANCE_MS = 60_000;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const callSchema = z.object({
  name: z.string(),
  arguments: z.string(),
  /** The native side dropped arguments that grew too long. */
  overflow: z.boolean().optional(),
  /** Calls past the native side's limit, reported once per reply. */
  dropped: z.number().int().positive().optional(),
});
const addReminderSchema = z.object({ text: z.string(), remind_at: z.string().optional(), repeat: z.string().optional() });
const playActionSchema = z.object({ action: z.string().regex(ACTION_ID_PATTERN) });
const saveNoteSchema = z.object({ text: z.string() });

const pad = (value: number) => String(value).padStart(2, "0");

/** Local time as the native side expects it: "2026-11-16 14:03 周一". */
export function localTimeText(now: number): string {
  const date = new Date(now);
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())} 周${WEEKDAYS[date.getDay()]}`;
}

/** What the user keeps on this computer that the model may look up. */
export interface SavedItems {
  agenda: readonly AgendaItem[];
  notes: readonly Note[];
  focusLog: FocusLog;
}

/** For a request that never looks anything up, such as the prompt preview. */
export const NOTHING_SAVED: SavedItems = { agenda: [], notes: [], focusLog: {} };

export function loadSavedItems(): SavedItems {
  return { agenda: loadAgenda(), notes: loadNotes(), focusLog: loadFocusLog() };
}

/**
 * What the model needs to know besides the conversation: the local time, the
 * actions it may pick, and what the user saved. The native side shows the
 * model the saved lists only when it looks them up.
 */
export function chatContext(now: number, actions: readonly string[], saved: SavedItems): ChatContext {
  return {
    now: localTimeText(now),
    actions: actions.filter((id) => ACTION_ID_PATTERN.test(id)),
    reminders: reminderLines(saved.agenda, now),
    notes: sortNotes(saved.notes).map((note) => note.text),
    today: todayLines(saved, now),
  };
}

/**
 * Today's record for a daily review: reminders ticked off today, today's ones
 * still open, focus rounds, and notes written or changed today. The focus line
 * is always there, so the model does not guess at it.
 */
export function todayLines({ agenda, notes, focusLog }: SavedItems, now: number): string[] {
  const start = new Date(now).setHours(0, 0, 0, 0);
  const end = new Date(now).setHours(24, 0, 0, 0);
  const done = agenda.filter((item) => item.doneAt !== null && item.doneAt >= start && item.doneAt < end);
  const open = agenda.filter((item) => !isDone(item, now) && shownAt(item, now) < end);
  const rounds = focusRounds(focusLog, now);
  const lines = [
    ...done.map((item) => `完成了提醒：${item.text}`),
    ...open.map((item) => `还没处理的提醒：${reminderLabel(shownAt(item, now), now)} ${item.text}`),
    `专注了 ${rounds} 轮，每轮 ${FOCUS_CONFIG.focusMs / 60_000} 分钟`,
    ...sortNotes(notes).filter((note) => note.updatedAt >= start).map((note) => `今天记的备忘：${clip(note.text.replace(/\s+/g, " "), TODAY_NOTE_CHARS)}`),
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

function parseArguments<T>(schema: z.ZodType<T>, raw: string): T | null {
  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    console.warn("Ignoring invalid tool arguments", error);
    return null;
  }
}

/** Cuts `text` to `limit` UTF-16 units without splitting a character. */
function clip(text: string, limit: number): string {
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

export interface ToolOutcome {
  items: ToolReminder[];
  notes: ToolNote[];
  /** Why each call that could not be saved was rejected, in words for the user. */
  failures: string[];
  action: string | null;
}

/** The text of a reminder or note, cut to `limit`; null when there is none. */
function readText(raw: string, limit: number): { text: string; trimmed: boolean } | null {
  const text = raw.trim();
  if (!text) return null;
  const kept = clip(text, limit).trim();
  return { text: kept, trimmed: kept !== text };
}

/**
 * Turns the tool calls of one reply into reminders, notes and an action.
 * Nothing is dropped silently: overlong text is cut and marked, a reminder
 * without a usable time becomes a note with the reason, and calls that cannot
 * be saved at all come back as failures to show the user.
 */
export function interpretToolCalls(payloads: readonly string[], now: number, makeId: () => string): ToolOutcome {
  const outcome: ToolOutcome = { items: [], notes: [], failures: [], action: null };
  for (const payload of payloads) {
    const call = parseArguments(callSchema, payload);
    if (!call) { outcome.failures.push("没看懂这条记录请求"); continue; }
    if (call.dropped) { outcome.failures.push(`一次最多记 ${MAX_CALLS_SHOWN} 条，后面 ${call.dropped} 条没记上`); continue; }
    if (call.overflow) { outcome.failures.push("内容太长"); continue; }
    if (call.name === ADD_REMINDER_TOOL) {
      const args = parseArguments(addReminderSchema, call.arguments);
      const text = args && readText(args.text, AGENDA_LIMITS.text);
      if (!args || !text) { outcome.failures.push("没看懂要提醒什么"); continue; }
      const remindAt = args.remind_at ? parseLocalTime(args.remind_at) : null;
      const rule = args.repeat?.trim() ? args.repeat : undefined;
      const repeat = rule ? parseRepeat(rule) : null;
      // A repeating reminder only takes the time of day, so a past date does not matter.
      if (remindAt !== null && (repeat !== null || remindAt >= now - PAST_TOLERANCE_MS)) {
        outcome.items.push({ id: makeId(), text: text.text, remindAt, repeat, trimmed: text.trimmed, onceOnly: rule !== undefined && repeat === null });
      } else {
        const note = readText(args.text, NOTE_LIMITS.text);
        if (note) outcome.notes.push({ ...note, fallback: remindAt === null ? "no-time" : "past" });
      }
    } else if (call.name === SAVE_NOTE_TOOL) {
      const args = parseArguments(saveNoteSchema, call.arguments);
      const text = args && readText(args.text, NOTE_LIMITS.text);
      if (text) outcome.notes.push(text);
      else outcome.failures.push("没看懂要存什么");
    } else if (call.name === PLAY_ACTION_TOOL) {
      // A wrong action only means the pet does not move; nothing the user asked for is lost.
      outcome.action = parseArguments(playActionSchema, call.arguments)?.action ?? outcome.action;
    } else {
      outcome.failures.push("没看懂这条记录请求");
    }
  }
  return outcome;
}

/** Why a reminder became a note, in words for the user. */
export const FALLBACK_REASONS: Record<NonNullable<ToolNote["fallback"]>, string> = {
  past: "时间已经过了，先存进备忘了",
  "no-time": "没听懂时间，先存进备忘了",
};

/** A reply for when the model only called tools and said nothing. */
export function confirmationFor(items: readonly NewAgendaItem[], now: number, notes: readonly ToolNote[] = [], failures: readonly string[] = []): string {
  const fallbacks = [...new Set(notes.flatMap((note) => (note.fallback ? [FALLBACK_REASONS[note.fallback]] : [])))];
  return [
    ...items.map((item) => (item.repeat
      ? `好，以后${repeatLabel(item.repeat)} ${clockLabel(item.remindAt)} 都提醒你：${item.text}`
      : `好，${formatReminderTime(item.remindAt, now)} 提醒你：${item.text}`)),
    ...(notes.some((note) => !note.fallback) ? ["好，存进备忘了"] : []),
    ...fallbacks,
    ...(failures.length > 0 ? ["有的没记上，看下面的说明"] : []),
  ].join("。");
}
