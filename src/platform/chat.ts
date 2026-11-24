import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { WebMode, WebReply } from "../chat/ReadLinks";
import type { ChatImage } from "../chat/ChatImage";

/**
 * `unprompted`: a line the pet said by itself, which the user then answered; it opens the thread.
 * `file`: a text file sent with the message, its text in `content` after the user's words (`handedMessage`); `label` finds where it starts.
 * `effects`: on a reply, the lines for what its tools did (`keptEffects`); shown under it, never sent to the model.
 */
export type ChatMessage = { role: "user" | "assistant"; content: string; readLink?: WebMode; web?: WebReply; image?: ChatImage; file?: { name: string; label: string }; unprompted?: true; effects?: KeptEffect[] };

/** A line for something a reply's tools did, as kept in the history: the words, and whether it could not be done. */
export type KeptEffect = { text: string; failed?: true };

/** Events of the chat window itself. Model requests are in `src/ai/`. */
export const chatPlatform = {
  /** The chat window was closed; it is only hidden. */
  async onHidden(handler: () => void): Promise<() => void> { return isTauri() ? listen("pet://chat-hide", handler) : () => {}; },
  /** "新聊天" (⌘N) in the app menu. Must match `NEW_CHAT_EVENT` in `src-tauri/src/lib.rs`. */
  async onNewChat(handler: () => void): Promise<() => void> { return isTauri() ? listen("pet://chat-new", handler) : () => {}; },
};
