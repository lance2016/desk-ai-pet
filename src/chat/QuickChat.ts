import type { ChatMessage } from "../platform/chat";
import { CHAT_LIMITS, type ChatThread } from "./ChatThreads";
import { parseMarkdown, type Inline } from "./markdown";

export const QUICK_CHAT_CONFIG = {
  /** After the bar closes, a finished reply stays up for a time that suits its length. */
  lingerBaseMs: 4_000,
  lingerPerCharMs: 120,
  lingerMinMs: 6_000,
  lingerMaxMs: 20_000,
};

/**
 * The thread a quick line continues, or null to start a new one. Each opening
 * of the bar is a new conversation: only the thread this opening already wrote
 * to (`sessionThreadId`) is continued.
 */
export function pickQuickThread(threads: readonly ChatThread[], sessionThreadId: string | null): ChatThread | null {
  return threads.find((thread) => thread.id === sessionThreadId) ?? null;
}

/** The thread so far plus the new line, as it is kept; send `contextMessages()` of it. */
export function quickHistory(thread: ChatThread | null, text: string): ChatMessage[] {
  return [...(thread?.messages ?? []), { role: "user" as const, content: text }].slice(-CHAT_LIMITS.messages);
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
