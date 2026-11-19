import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { WebMode, WebReply } from "../chat/ReadLinks";
import type { ChatImage } from "../chat/ChatImage";

export type ChatMessage = { role: "user" | "assistant"; content: string; readLink?: WebMode; web?: WebReply; image?: ChatImage };

/** Events of the chat window itself. Model requests are in `src/ai/`. */
export const chatPlatform = {
  /** The chat window was closed; it is only hidden. */
  async onHidden(handler: () => void): Promise<() => void> { return isTauri() ? listen("pet://chat-hide", handler) : () => {}; },
  /** "新聊天" (⌘N) in the app menu. Must match `NEW_CHAT_EVENT` in `src-tauri/src/lib.rs`. */
  async onNewChat(handler: () => void): Promise<() => void> { return isTauri() ? listen("pet://chat-new", handler) : () => {}; },
};
