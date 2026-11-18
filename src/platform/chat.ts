import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatRequestPreferences } from "../preferences/ChatPreferences";
import { z } from "zod";

export type ChatMessage = { role: "user" | "assistant"; content: string };
const eventSchema = z.object({ id: z.string(), kind: z.enum(["delta", "tool", "done", "error", "cancelled"]), text: z.string() });
export type ChatEvent = z.infer<typeof eventSchema>;
/** The local time and the pet actions the model may pick; see `chatContext`. */
export interface ChatContext { now: string; actions: string[] }
export interface ChatPreview { prompt: string; tools: unknown[] }
function requireNative() { if (!isTauri()) throw new Error("请在桌面应用中使用聊天功能。"); }
export const chatPlatform = {
  async openKeyPage(): Promise<void> { requireNative(); await invoke("open_deepseek_key_page"); },
  async keyStatus(): Promise<boolean> { requireNative(); return invoke("deepseek_key_status"); },
  async saveKey(key: string): Promise<void> { requireNative(); await invoke("deepseek_save_key", { key }); },
  /** Sends a tiny message to `model`, to check the key and the model name. */
  async test(model: string): Promise<void> { requireNative(); await invoke("deepseek_test", { model }); },
  async clearKey(): Promise<void> { requireNative(); await invoke("deepseek_clear_key"); },
  async start(requestId: string, messages: ChatMessage[], preferences: ChatRequestPreferences, context: ChatContext): Promise<void> { requireNative(); await invoke("deepseek_start", { requestId, messages, preferences, context }); },
  async translate(requestId: string, text: string, target: "zh" | "en", model: string): Promise<void> { requireNative(); await invoke("deepseek_translate", { requestId, text, target, model }); },
  async preview(preferences: ChatRequestPreferences, context: ChatContext): Promise<ChatPreview> { requireNative(); return invoke("deepseek_preview", { preferences, context }); },
  /** A one-line morning or evening greeting in the character's voice. `now` is `localTimeText()`. */
  async greet(kind: "morning" | "evening", facts: string[], preferences: ChatRequestPreferences, now: string): Promise<string> { requireNative(); return invoke<string>("deepseek_greet", { kind, facts, preferences, now }); },
  /** A few words naming a conversation from its first exchange. */
  async title(user: string, reply: string, model: string): Promise<string> { requireNative(); return invoke<string>("deepseek_title", { user, reply, model }); },
  async cancel(requestId: string): Promise<void> { requireNative(); await invoke("deepseek_cancel", { requestId }); },
  async onHidden(handler: () => void): Promise<() => void> { requireNative(); return listen("pet://chat-hide", handler); },
  /** "新聊天" (⌘N) in the app menu. Must match `NEW_CHAT_EVENT` in `src-tauri/src/lib.rs`. */
  async onNewChat(handler: () => void): Promise<() => void> { return isTauri() ? listen("pet://chat-new", handler) : () => {}; },
  async subscribe(handler: (event: ChatEvent) => void): Promise<() => void> {
    requireNative();
    return listen("pet://chat-stream", (event) => { const parsed = eventSchema.safeParse(event.payload); if (parsed.success) handler(parsed.data); });
  },
};
