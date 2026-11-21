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
};

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
