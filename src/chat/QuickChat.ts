import type { ChatMessage } from "../platform/chat";
import { CHAT_LIMITS, type ChatThread } from "./ChatThreads";
import { parseMarkdown, type Inline } from "./markdown";

export const QUICK_CHAT_CONFIG = {
  /** A quick line joins the latest thread if it was active this recently; otherwise it starts a new one. */
  continueWithinMs: 30 * 60_000,
  /** After the bar closes, a finished reply stays up for a time that suits its length. */
  lingerBaseMs: 4_000,
  lingerPerCharMs: 120,
  lingerMinMs: 6_000,
  lingerMaxMs: 20_000,
};

/** The thread a quick line continues, or null to start a new one. Threads are kept most recent first. */
export function pickQuickThread(threads: readonly ChatThread[], now: number): ChatThread | null {
  const latest = threads[0];
  return latest && now - latest.updatedAt <= QUICK_CHAT_CONFIG.continueWithinMs ? latest : null;
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
