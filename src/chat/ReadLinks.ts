import { z } from "zod";

/** Bounds the extra space used by DeepSeek's opaque webpage snapshots in local chat history. */
export const LINK_CONTEXT_BUDGET = 512 * 1024;
const MAX_LINK_LENGTH = 2048;

export const webModeSchema = z.enum(["open", "follow", "search", "image"]);
export type WebMode = z.infer<typeof webModeSchema>;

export function webAddress(value: string): URL | null {
  if (value.length > MAX_LINK_LENGTH || /\s/.test(value) || !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.hostname && !url.username && !url.password && url.href.length <= MAX_LINK_LENGTH ? url : null;
  } catch {
    return null;
  }
}

export function findWebAddresses(text: string): { start: number; text: string; url: URL }[] {
  const addresses = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`，。！？；、（）【】《》「」]+/gi)) {
    let label = match[0].replace(/[.,!?;]+$/, "");
    for (const [open, close] of [["(", ")"], ["[", "]"]]) {
      const balance = label.split(open).length - label.split(close).length;
      for (let extra = -balance; extra > 0 && label.endsWith(close); extra--) label = label.slice(0, -1);
    }
    const url = webAddress(label);
    if (url) addresses.push({ start: match.index ?? 0, text: label, url });
  }
  return addresses;
}

export const containsWebAddress = (text: string): boolean => findWebAddresses(text).length > 0;

export const webReplySchema = z.object({
  sources: z.array(z.object({ url: z.string().max(MAX_LINK_LENGTH), title: z.string().max(512) })).max(20),
  calls: z.string().max(LINK_CONTEXT_BUDGET).optional(),
  incomplete: z.boolean(),
  truncated: z.boolean(),
});
export type WebReply = z.infer<typeof webReplySchema>;

type LinkMessage = { role: string; readLink?: WebMode; web?: WebReply };

/** Find the active webpage turn. An ordinary message ends the sequence. */
export function webConversationStart(messages: readonly LinkMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "user" && message.readLink === "open") {
      return messages[index + 1]?.web?.calls ? index : -1;
    }
    if (message.role === "user" ? message.readLink !== "follow" : !message.web) break;
  }
  return -1;
}
