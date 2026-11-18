import { addAgendaItem, itemSummary, updateAgenda } from "../agenda/AgendaStore";
import { confirmationFor, FALLBACK_REASONS, interpretToolCalls, type ToolNote, type ToolReminder } from "../agenda/chatTools";
import { addNote, updateNotes } from "../notes/NoteStore";
import { petWindow } from "../platform/petWindow";

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** A note the reply saved. The id is the stored note's, which may be an older one with the same text. */
export interface SavedNote {
  id: string;
  text: string;
}

/** Saves `text` as a quick note and returns the stored note. Throws when it cannot be saved. */
export function saveNote(text: string): SavedNote {
  const notes = updateNotes((list) => addNote(list, { id: newId(), text }, Date.now()));
  // Texts are unique: saving one that exists brings that note forward.
  const saved = notes.find((note) => note.text === text.trim());
  if (!saved) throw new Error("The note was not saved");
  return { id: saved.id, text: saved.text };
}

/** What one reply saved, or failed to save, as the chat shows it under the reply. */
export interface SavedLine {
  /** The reminder or note to open; none for a failure. */
  id?: string;
  kind: "agenda" | "note" | "failed";
  text: string;
}

export interface ToolEffects {
  lines: SavedLine[];
  /** A reply for when the model only called tools and said nothing. */
  confirmation: string;
}

const TRIMMED = "（已截短）";

function reminderLine(item: ToolReminder, now: number): SavedLine {
  const marks = `${item.trimmed ? TRIMMED : ""}${item.onceOnly ? "（这种重复方式不支持，只提醒一次）" : ""}`;
  return { id: item.id, kind: "agenda", text: `已设提醒：${itemSummary(item, now)}${marks}` };
}

function noteLine(note: ToolNote, saved: SavedNote): SavedLine {
  const lead = note.fallback ? FALLBACK_REASONS[note.fallback] : "已存进备忘";
  return { id: saved.id, kind: "note", text: `${lead}：${saved.text}${note.trimmed ? TRIMMED : ""}` };
}

/**
 * Saves the reminders and notes the model asked to keep.
 * Returns a line for everything the reply asked to keep, including what could
 * not be kept and why, and a reply for a reply-less answer.
 */
export function applyToolCalls(payloads: string[]): ToolEffects {
  if (payloads.length === 0) return { lines: [], confirmation: "" };
  const now = Date.now();
  const { items, notes, failures } = interpretToolCalls(payloads, now, newId);
  if (items.length > 0) updateAgenda((list) => items.reduce((next, item) => addAgendaItem(next, item, now), list));
  const saved = notes.map((note) => noteLine(note, saveNote(note.text)));
  return {
    lines: [
      ...items.map((item) => reminderLine(item, now)),
      ...saved,
      ...failures.map((reason) => ({ kind: "failed" as const, text: `这条没记上：${reason}。可以再说一次，或者自己在提醒、备忘里添加` })),
    ],
    confirmation: confirmationFor(items, now, notes, failures),
  };
}

/** Dispatches immediately and resolves to a fallback reply or an actual scheduling failure. */
export async function dispatchChatAction(id: string, requestId: string): Promise<ToolEffects> {
  if (id) {
    try {
      const result = await petWindow.requestChatAction(id, requestId);
      if (result.accepted && result.actionId === id) return { lines: [], confirmation: "好，来吧。" };
      console.warn("The pet declined a chat action", id, result);
      if (!result.accepted && (result.reason === "busy" || result.reason === "cooldown")) {
        const reason = result.reason === "busy" ? "宠物现在正忙，暂时做不了这个动作。" : "这个动作刚做过，等一下再试。";
        return { lines: [{ kind: "failed", text: reason }], confirmation: reason };
      }
    } catch (error) {
      console.warn("Could not dispatch the chat action", id, error);
    }
  } else {
    console.warn("The model returned incomplete or unavailable action arguments");
  }
  const reason = "这个动作现在播不了。";
  return { lines: [{ kind: "failed", text: reason }], confirmation: reason };
}
