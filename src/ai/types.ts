/** The local time, the pet actions the model may pick, and the saved lists it may look up; see `chatContext`. */
export interface ChatContext { now: string; timestamp: string; timeZone: string; actions: string[]; reminders: string[]; notes: string[]; today: string[] }

/** One part of the system prompt. A part with a `default` is one the user can rewrite (`ChatRules`). */
export interface PromptSection { id: string; title: string; text: string; default: string | null }
export interface ChatPreview { prompt: string; tools: unknown[]; sections: PromptSection[] }

/**
 * What a reply in progress tells the window that asked for it.
 * `tool` carries a call the window saves (a reminder or a note); `action` a pet action to play now.
 */
export interface ChatEvent {
  id: string;
  kind: "delta" | "tool" | "action" | "web-progress" | "web-result" | "web-error" | "done" | "error" | "cancelled";
  text: string;
}

/** A one-off job on a piece of text: translate into Chinese ("zh") or English ("en"), or explain, summarize, polish. */
export type TextTask = "zh" | "en" | "explain" | "summarize" | "polish";
