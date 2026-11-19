import type { WebMode } from "../chat/ReadLinks";
import { llmPlatform } from "../platform/llm";
import { systemPlatform } from "../platform/system";
import type { ChatRequestPreferences } from "../preferences/ChatPreferences";
import { cancelRun, startRun, subscribeRuns, type ToolSetup } from "./chatRun";
import { greet, testConnection } from "./completions";
import { previewChat } from "./prompt";
import { DEEPSEEK } from "./provider";
import { readRequestLog } from "./requestLog";
import { chatRequest, textTaskRequest, webRequest, type OutgoingMessage } from "./requests";
import type { TextTask } from "./types";

export type { ChatContext, ChatEvent, ChatPreview, PromptSection, TextTask } from "./types";
export type { ChatRequestLog } from "./requestLog";
export type { EffectLine, Skill } from "./skill";

/**
 * What one chat message asks for: an ordinary turn with the local tools of `skills`,
 * or a webpage, search or picture turn (`mode`), which never gets local tools.
 */
export type ChatTurn = ToolSetup | { mode: WebMode };

/**
 * The AI module: everything the app asks a model for. Windows use only this; how requests are
 * built and replies are read stays inside `src/ai/`, and the keys and network stay in the native side.
 * What the model may do in a chat comes from the skills a window passes in (`src/skills/`).
 */
export const ai = {
  provider: DEEPSEEK,
  keyStatus: (): Promise<boolean> => llmPlatform.keyStatus(DEEPSEEK.id),
  saveKey: (key: string): Promise<void> => llmPlatform.saveKey(DEEPSEEK.id, key),
  clearKey: (): Promise<void> => llmPlatform.clearKey(DEEPSEEK.id),
  openKeyPage: (): Promise<void> => systemPlatform.openLink(DEEPSEEK.keyPage),
  test: testConnection,
  greet,
  /** The prompt and tools a chat request would send, for the settings preview. */
  preview: previewChat,
  /** Starts a chat reply; it streams to `subscribe`, with a line for each thing its tools did. */
  async start(id: string, messages: readonly OutgoingMessage[], preferences: ChatRequestPreferences, turn: ChatTurn): Promise<void> {
    if ("mode" in turn) return startRun(id, webRequest(messages, turn.mode), { mode: turn.mode, record: preferences.record });
    return startRun(id, chatRequest(messages, preferences, turn.context, turn.skills), { tools: turn, record: preferences.record });
  },
  /** Runs one text task on text the user handed over; the result streams to `subscribe`. */
  translate: async (id: string, text: string, task: TextTask, model: string): Promise<void> =>
    startRun(id, textTaskRequest(text, task, model), { record: false }),
  cancel: cancelRun,
  subscribe: subscribeRuns,
  requestLog: readRequestLog,
  clearRequestLog: (): Promise<void> => llmPlatform.clearLog(),
};
