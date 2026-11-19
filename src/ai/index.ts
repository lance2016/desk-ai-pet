import type { WebMode } from "../chat/ReadLinks";
import { llmPlatform } from "../platform/llm";
import { systemPlatform } from "../platform/system";
import type { ChatRequestPreferences } from "../preferences/ChatPreferences";
import { cancelRun, NO_LISTS, startRun, subscribeRuns } from "./chatRun";
import { greet, testConnection } from "./completions";
import { previewChat } from "./prompt";
import { DEEPSEEK } from "./provider";
import { readRequestLog } from "./requestLog";
import { chatRequest, textTaskRequest, webRequest, type OutgoingMessage } from "./requests";
import { MAX_ACTIONS } from "./tools";
import type { ChatContext, TextTask } from "./types";

export type { ChatContext, ChatEvent, ChatPreview, PromptSection, TextTask } from "./types";
export type { ChatRequestLog } from "./requestLog";

/**
 * The AI module: everything the app asks a model for. Windows use only this; how requests are
 * built and replies are read stays inside `src/ai/`, and the keys and network stay in the native side.
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
  /**
   * Starts a chat reply; it streams to `subscribe`. A webpage, search or picture turn (`mode`) needs no context:
   * it never gets the local tools or the saved lists.
   */
  async start(id: string, messages: readonly OutgoingMessage[], preferences: ChatRequestPreferences, context: ChatContext | null, mode?: WebMode): Promise<void> {
    if (mode) return startRun(id, webRequest(messages, mode), { mode, lists: NO_LISTS, actions: [], record: preferences.record });
    if (!context) throw new Error("Invalid chat context");
    return startRun(id, chatRequest(messages, preferences, context), { lists: context, actions: context.actions.slice(0, MAX_ACTIONS), record: preferences.record });
  },
  /** Runs one text task on text the user handed over; the result streams to `subscribe`. */
  translate: async (id: string, text: string, task: TextTask, model: string): Promise<void> =>
    startRun(id, textTaskRequest(text, task, model), { lists: NO_LISTS, actions: [], record: false }),
  cancel: cancelRun,
  subscribe: subscribeRuns,
  requestLog: readRequestLog,
  clearRequestLog: (): Promise<void> => llmPlatform.clearLog(),
};
