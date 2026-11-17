import { z } from "zod";
import { NOTE_LIMITS } from "../notes/NoteStore";
import { AGENDA_LIMITS, clockLabel, formatReminderTime, type NewAgendaItem } from "./AgendaStore";
import { parseRepeat, repeatLabel } from "./Repeat";

/** Tool names; must match `src-tauri/src/chat.rs`. */
const ADD_REMINDER_TOOL = "add_reminder";
const PLAY_ACTION_TOOL = "play_action";
const SAVE_NOTE_TOOL = "save_note";
/** Action ids the native side accepts. */
const ACTION_ID_PATTERN = /^[a-z0-9_]{1,40}$/;
/** Must match `MAX_TOOL_CALLS` in `src-tauri/src/chat.rs`. */
const MAX_CALLS_SHOWN = 8;
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

/** What the model needs to know besides the conversation: the local time and the actions it may pick. */
export function chatContext(now: number, actions: readonly string[]): { now: string; actions: string[] } {
  return { now: localTimeText(now), actions: actions.filter((id) => ACTION_ID_PATTERN.test(id)) };
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
