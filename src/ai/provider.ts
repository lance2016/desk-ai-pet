import { DEFAULT_CHAT_MODEL } from "../preferences/ChatModel";

/**
 * The model service. Only DeepSeek for now. `id` must match `PROVIDERS` in `src-tauri/src/llm.rs`,
 * which holds the address the key may be sent to.
 */
export const DEEPSEEK = {
  id: "deepseek",
  name: "DeepSeek",
  keyPage: "https://platform.deepseek.com/api_keys",
  /** Webpage, search and picture turns use DeepSeek's own tools, which this model has. */
  webModel: DEFAULT_CHAT_MODEL,
} as const;

/** Every request asks for an answer without the slower reasoning mode. */
export const THINKING_OFF = { thinking: { type: "disabled" } } as const;

/**
 * What the user is told when a request fails, by HTTP status.
 * The wording must match `RULES` in `src/chat/serviceErrors.ts`.
 */
export function failureMessage(status: number | null): string {
  if (status === 401) return "API Key 无效，请在设置中检查。";
  if (status === 402) return "账户余额不足，请检查 DeepSeek 账户。";
  if (status === 429) return "请求过于频繁，请稍后重试。";
  if (status === 400 || status === 422) return "这条消息发不出去，换个说法或新开一段聊天。";
  if (status !== null && status >= 500 && status <= 599) return "DeepSeek 服务繁忙，稍后再试。";
  return "连接或回复中断，请检查网络后重试。";
}

export const isSuccess = (status: number | null): boolean => status !== null && status >= 200 && status < 300;
