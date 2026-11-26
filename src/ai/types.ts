import type { ChatRuleId } from "../preferences/ChatRules";
import type { EffectLine } from "./skill";

/**
 * What the pet knows about the user (`src/facts/`). `mine` the user wrote and always holds;
 * `learned` chats picked up, numbered so the tools can name one; `learning`: chats may change them.
 */
export interface ChatFacts { mine: string[]; learned: { ref: string; id: string; text: string }[]; learning: boolean }

/** The local time, the pet actions the model may pick and what it knows about the user; see `chatContext`. */
/**
 * `opening`: what the pet said by itself to start this chat, when it did.
 * `skillsOff`, `toolsOff`: skills, and single tools by name, the user turned off in settings.
 */
export interface ChatContext { now: string; timestamp: string; timeZone: string; actions: string[]; facts: ChatFacts; opening?: string; skillsOff?: readonly ChatRuleId[]; toolsOff?: readonly string[] }

/** One part of the system prompt. A part with a `default` is one the user can rewrite (`ChatRules`). */
export interface PromptSection { id: string; title: string; text: string; default: string | null }
export interface ChatPreview { prompt: string; tools: unknown[]; sections: PromptSection[] }

/**
 * What a reply in progress tells the window that asked for it.
 * `effect` is something a tool did, shown as a line under the reply; `tool` names one that starts now, by its `label`.
 */
export type ChatEvent =
  | { id: string; kind: "delta" | "tool" | "web-progress" | "web-result" | "web-error" | "done" | "error" | "cancelled"; text: string }
  | { id: string; kind: "effect"; line: EffectLine };

/** A one-off job on a piece of text: translate into Chinese ("zh") or English ("en"). */
export type TextTask = "zh" | "en";
