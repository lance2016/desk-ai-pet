import type { EffectLine } from "./skill";

/** The local time and the pet actions the model may pick; see `chatContext`. */
export interface ChatContext { now: string; timestamp: string; timeZone: string; actions: string[] }

/** One part of the system prompt. A part with a `default` is one the user can rewrite (`ChatRules`). */
export interface PromptSection { id: string; title: string; text: string; default: string | null }
export interface ChatPreview { prompt: string; tools: unknown[]; sections: PromptSection[] }

/**
 * What a reply in progress tells the window that asked for it.
 * `effect` is something a tool did, shown as a line under the reply.
 */
export type ChatEvent =
  | { id: string; kind: "delta" | "web-progress" | "web-result" | "web-error" | "done" | "error" | "cancelled"; text: string }
  | { id: string; kind: "effect"; line: EffectLine };

/** A one-off job on a piece of text: translate into Chinese ("zh") or English ("en"), or explain, summarize, polish. */
export type TextTask = "zh" | "en" | "explain" | "summarize" | "polish";
