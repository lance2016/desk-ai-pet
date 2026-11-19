import { z } from "zod";
import type { ChatMessage } from "../platform/chat";
import { CHARACTER_DATA, characterKey } from "../preferences/CharacterPreferences";
import { LINK_CONTEXT_BUDGET, webModeSchema, webReplySchema } from "./ReadLinks";
import { chatImageSchema } from "./ChatImage";

/**
 * Messages kept and shown per thread; the latest of them sent to the model as
 * context; threads kept per character; title length.
 */
export const CHAT_LIMITS = { messages: 200, context: 30, threads: 20, titleChars: 18 } as const;
const MAX_MESSAGE_CHARS = 16000;
const FALLBACK_TITLE = "新聊天";
/** Global switch: normalize each new thread title locally. */
const AUTO_TITLES_KEY = "ai-pet:chat-auto-titles:v1";

const messagesSchema = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
  readLink: webModeSchema.optional(),
  web: webReplySchema.optional(),
  image: chatImageSchema.optional(),
})).max(CHAT_LIMITS.messages);
const threadsSchema = z.array(z.object({
  id: z.string().min(1).max(100),
  title: z.string().max(CHAT_LIMITS.titleChars + 1),
  updatedAt: z.number(),
  messages: messagesSchema,
})).max(CHAT_LIMITS.threads);

/** One conversation. Threads are kept most recent first. */
export type ChatThread = z.infer<typeof threadsSchema>[number];

const threadsKey = (packId: string) => characterKey(packId, CHARACTER_DATA.chatThreads);
/** Whether a `storage` event may have changed this character's threads (a null key means all were cleared). */
export const touchesThreads = (packId: string, key: string | null) => key === null || key === threadsKey(packId);
/** Before threads existed each character had one running history. */
const legacyKey = (packId: string) => characterKey(packId, CHARACTER_DATA.chatHistory);

function shorten(text: string): string {
  const chars = [...text];
  return chars.length > CHAT_LIMITS.titleChars ? `${chars.slice(0, CHAT_LIMITS.titleChars).join("")}…` : text;
}

/** The first thing the user said, on one line and cut short. */
export function threadTitle(messages: readonly ChatMessage[]): string {
  const first = messages.find((message) => message.role === "user")?.content.replace(/\s+/g, " ").trim();
  return first ? shorten(first) : FALLBACK_TITLE;
}

/** A title on one line, without a "标题：" label, quotes or end punctuation. Empty when nothing is left. */
export function cleanTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim()
    .replace(/^(标题|题目)\s*[:：]\s*/, "")
    .replace(/^["'“”‘’「」《》]+|["'“”‘’「」《》。.!！?？,，、;；:：…\s]+$/g, "")
    .trim();
  return line ? shorten(line) : "";
}

/** Puts a thread's latest messages first in the list. Threads without messages are not kept. */
export function recordThread(threads: readonly ChatThread[], id: string, messages: readonly ChatMessage[], now: number): ChatThread[] {
  const others = threads.filter((thread) => thread.id !== id);
  if (messages.length === 0) return others;
  const kept = messages.slice(-CHAT_LIMITS.messages);
  const previous = threads.find((thread) => thread.id === id);
  const first = threadTitle(kept);
  let title = previous?.title ?? first;
  if (title === first && kept.some((message) => message.role === "assistant")
    && !previous?.messages.some((message) => message.role === "assistant") && loadAutoTitles()) {
    const opening = kept.find((message) => message.role === "user")?.content ?? "";
    title = cleanTitle(opening) || first;
  }
  return [{ id, title, updatedAt: now, messages: kept }, ...others].slice(0, CHAT_LIMITS.threads);
}

/** Gives a thread a new title without moving it. Unknown ids and empty titles change nothing. */
export function retitleThread(threads: readonly ChatThread[], id: string, title: string): ChatThread[] {
  const cleaned = cleanTitle(title);
  if (!cleaned || !threads.some((thread) => thread.id === id)) return [...threads];
  return threads.map((thread) => thread.id === id ? { ...thread, title: cleaned } : thread);
}

/** The latest messages to send to the model, never opening with a reply. */
export function contextMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  const recent = messages.slice(-CHAT_LIMITS.context);
  const firstUser = recent.findIndex((message) => message.role === "user");
  return firstUser === -1 ? [] : recent.slice(firstUser);
}

export function removeThread(threads: readonly ChatThread[], id: string): ChatThread[] {
  return threads.filter((thread) => thread.id !== id);
}

/** Puts back a thread that was just deleted (undo), in its place by time. Does nothing if it is still there. */
export function restoreThread(threads: readonly ChatThread[], removed: ChatThread): ChatThread[] {
  if (threads.some((thread) => thread.id === removed.id)) return [...threads];
  return [...threads, removed].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, CHAT_LIMITS.threads);
}

/**
 * Reads a character's threads, moving the old single history into the first one.
 * Unreadable data is reported as invalid and left in place so nothing overwrites it.
 */
export function loadThreads(packId: string, storage: Storage = window.localStorage, now = Date.now()): { threads: ChatThread[]; valid: boolean } {
  try {
    const raw = storage.getItem(threadsKey(packId));
    if (raw !== null) return { threads: threadsSchema.parse(JSON.parse(raw)), valid: true };
    const legacy = storage.getItem(legacyKey(packId));
    if (legacy === null) return { threads: [], valid: true };
    const threads = recordThread([], `legacy-${now}`, messagesSchema.parse(JSON.parse(legacy)), now);
    saveThreads(packId, threads, storage);
    storage.removeItem(legacyKey(packId));
    return { threads, valid: true };
  } catch (error) {
    console.warn("Failed to read chat threads", error);
    return { threads: [], valid: false };
  }
}

export function saveThreads(packId: string, threads: readonly ChatThread[], storage: Storage = window.localStorage): void {
  let remaining = LINK_CONTEXT_BUDGET;
  const bounded = threads.map((thread) => {
    const messages = thread.messages.slice();
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      const calls = message.web?.calls;
      if (!calls || !message.web) continue;
      if (calls.length <= remaining) remaining -= calls.length;
      else messages[index] = { ...message, web: { ...message.web, calls: undefined } };
    }
    return { ...thread, messages };
  });
  storage.setItem(threadsKey(packId), JSON.stringify(threadsSchema.parse(bounded)));
}

/** Deletes every thread of a character, including an unreadable old history. */
export function clearThreads(packId: string, storage: Storage = window.localStorage): void {
  storage.removeItem(threadsKey(packId));
  storage.removeItem(legacyKey(packId));
}

export function loadAutoTitles(storage: Storage | undefined = globalThis.window?.localStorage): boolean {
  return storage?.getItem(AUTO_TITLES_KEY) !== "false";
}

export function saveAutoTitles(enabled: boolean, storage: Storage = window.localStorage): void {
  storage.setItem(AUTO_TITLES_KEY, String(enabled));
}
