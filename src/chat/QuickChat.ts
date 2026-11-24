import { z } from "zod";
import type { ChatMessage } from "../platform/chat";
import { CHAT_LIMITS, type ChatThread } from "./ChatThreads";
import { ANSWER_WINDOW_MS } from "../companion/history";
import { parseMarkdown, type Inline } from "./markdown";

export const QUICK_CHAT_CONFIG = {
  /** After the bar closes, a finished reply stays up for a time that suits its length. */
  lingerBaseMs: 4_000,
  lingerPerCharMs: 120,
  lingerMinMs: 6_000,
  lingerMaxMs: 20_000,
  /** After the pet says something by itself, opening the bar within this time answers that line. */
  answerWindowMs: ANSWER_WINDOW_MS,
  /** A reply mark older than this was left behind by a pet window that went away; real replies end well before. */
  replyingStaleMs: 5 * 60_000,
};

/** Which thread the pet window is answering, for the chat window. */
const REPLYING_KEY = "ai-pet:chat-replying:v1";
const replyingSchema = z.object({ threadId: z.string().min(1), at: z.number() });

/** The pet window started answering this thread. */
export function markReplying(threadId: string, storage: Storage = window.localStorage, now = Date.now()): void {
  storage.setItem(REPLYING_KEY, JSON.stringify({ threadId, at: now }));
}

/** The reply to this thread is over; a mark another reply set since is left alone. */
export function clearReplying(threadId: string, storage: Storage = window.localStorage): void {
  if (readReplying(storage)?.threadId === threadId) storage.removeItem(REPLYING_KEY);
}

/** The thread the pet window is answering now, or null. */
export function replyingThread(storage: Storage = window.localStorage, now = Date.now()): string | null {
  const mark = readReplying(storage);
  return mark && now - mark.at <= QUICK_CHAT_CONFIG.replyingStaleMs ? mark.threadId : null;
}

/** Whether a `storage` event may have changed the mark (a null key means everything was cleared). */
export const touchesReplying = (key: string | null) => key === null || key === REPLYING_KEY;

function readReplying(storage: Storage): z.infer<typeof replyingSchema> | null {
  try {
    const raw = storage.getItem(REPLYING_KEY);
    return raw === null ? null : replyingSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.warn("Unreadable chat reply mark", error);
    return null;
  }
}

/** A line the pet said by itself, and when. */
export interface Spoken { text: string; at: number }

/** The line the user would be answering by speaking now, or null once it is too long ago. */
export function answerable(spoken: Spoken | null, now: number): string | null {
  return spoken && now - spoken.at < QUICK_CHAT_CONFIG.answerWindowMs ? spoken.text : null;
}

/**
 * The thread a quick line continues, or null to start a new one. Each opening
 * of the bar is a new conversation: only the thread this opening already wrote
 * to (`sessionThreadId`) is continued.
 */
export function pickQuickThread(threads: readonly ChatThread[], sessionThreadId: string | null): ChatThread | null {
  return threads.find((thread) => thread.id === sessionThreadId) ?? null;
}

/**
 * The thread so far plus the new line, as it is kept; send `contextMessages()` of it.
 * `opening`: what the pet said by itself that this line answers; it starts a new thread.
 */
export function quickHistory(thread: ChatThread | null, text: string, opening: string | null = null): ChatMessage[] {
  const before: ChatMessage[] = thread?.messages ?? (opening ? [{ role: "assistant", content: opening, unprompted: true }] : []);
  return [...before, { role: "user" as const, content: text }].slice(-CHAT_LIMITS.messages);
}

/** A thread with its unanswered last line taken back out. Nothing is left when the user said nothing else in it. */
export function withoutLastLine(messages: readonly ChatMessage[]): ChatMessage[] {
  const rest = messages.slice(0, -1);
  return rest.some((message) => message.role === "user") ? rest : [];
}

const inlineText = (parts: Inline[]) => parts.map((part) => part.text).join("");

/** A Markdown reply as one plain line for the speech bubble. */
export function plainReply(markdown: string): string {
  return parseMarkdown(markdown)
    .map((block) => {
      if (block.kind === "paragraph") return block.lines.map(inlineText).join(" ");
      if (block.kind === "heading") return inlineText(block.inline);
      if (block.kind === "list") return block.items.map((item) => `· ${inlineText(item)}`).join(" ");
      return block.text;
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function replyLingerMs(text: string): number {
  const { lingerBaseMs, lingerPerCharMs, lingerMinMs, lingerMaxMs } = QUICK_CHAT_CONFIG;
  return Math.min(lingerMaxMs, Math.max(lingerMinMs, lingerBaseMs + [...text].length * lingerPerCharMs));
}
