import type { GreetingKind } from "../greeting/GreetingSchedule";
import { llmPlatform } from "../platform/llm";
import type { ChatRequestPreferences } from "../preferences/ChatPreferences";
import { DEEPSEEK, failureMessage, isSuccess, THINKING_OFF } from "./provider";

const GREETING_TOKENS = 120;
const OCCASIONS: Record<GreetingKind, string> = { morning: "向用户问好，开始新的一天", evening: "跟用户道晚安，收个尾" };

/** The request for a one-line morning or evening greeting in the character's voice. `now` is `localTimeText()`. */
export function greetingRequest(kind: GreetingKind, facts: readonly string[], preferences: ChatRequestPreferences, now: string): object {
  const userName = preferences.userName.trim();
  const system = `你是一位名叫${preferences.name}的中文桌面宠物。${userName ? `称呼用户为「${userName}」。` : ""}用户希望你的性格是：${preferences.personality}`;
  const user = `现在是${now}。请用一句不超过 40 个字的话${OCCASIONS[kind]}。可以自然地提到下面一两条信息，不要逐条罗列，不要加引号：\n- ${facts.join("\n- ")}`;
  return { model: preferences.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], stream: false, max_tokens: GREETING_TOKENS, ...THINKING_OFF };
}

/** The reply's text without the quotes models like to add, or null when there is none. */
export function greetingText(response: string): string | null {
  try {
    const packet: unknown = JSON.parse(response);
    const content = (packet as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const text = content.trim().replace(/^["“”]+|["“”]+$/g, "").trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function greet(kind: GreetingKind, facts: readonly string[], preferences: ChatRequestPreferences, now: string): Promise<string> {
  const result = await llmPlatform.complete(DEEPSEEK.id, greetingRequest(kind, facts, preferences, now));
  if (!result.ok) throw new Error("Request failed");
  const text = greetingText(result.body);
  if (!text) throw new Error("Empty reply");
  return text;
}

/** Sends a tiny message to `model`, to check the key and the model name. */
export async function testConnection(model: string): Promise<void> {
  const result = await llmPlatform.complete(DEEPSEEK.id, { model, messages: [{ role: "user", content: "你好" }], stream: false, max_tokens: 1, ...THINKING_OFF });
  if (result.ok && isSuccess(result.status)) return;
  // A one-word message cannot be rejected for its content: the model name is what is wrong.
  if (result.status === 400 || result.status === 404 || result.status === 422) throw new Error("模型名不可用，DeepSeek 不认识这个模型。");
  throw new Error(failureMessage(result.status));
}
