import { z } from "zod";

/** Built-in DeepSeek models, offered first in settings. The first is the default. */
export const CHAT_MODELS = [
  { id: "deepseek-flash", label: "Flash", hint: "反应快，适合日常聊天" },
  { id: "deepseek-pro", label: "Pro", hint: "更擅长复杂问题，回复慢一些，费用也更高" },
] as const;
export const DEFAULT_CHAT_MODEL = CHAT_MODELS[0].id;
/** A model name the user types; it goes into the request as it is. */
export const CHAT_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$/;

/** One model for every character: it is an account choice, not a personality. */
const KEY = "ai-pet:chat-model:v1";
const schema = z.string().regex(CHAT_MODEL_PATTERN);

export function isBuiltInModel(model: string): boolean {
  return CHAT_MODELS.some((item) => item.id === model);
}

export function loadChatModel(storage: Storage = window.localStorage): string {
  try {
    const raw = storage.getItem(KEY);
    return raw === null ? DEFAULT_CHAT_MODEL : schema.parse(raw);
  } catch (error) {
    console.warn("Ignoring an unreadable chat model", error);
    return DEFAULT_CHAT_MODEL;
  }
}

/** Saves a model name. Throws when the name has characters a model name never has. */
export function saveChatModel(model: string, storage: Storage = window.localStorage): void {
  storage.setItem(KEY, schema.parse(model.trim()));
}
