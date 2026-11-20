import { llmPlatform, type Completion } from "../platform/llm";
import type { ChatRequestPreferences } from "../preferences/ChatPreferences";
import { DEEPSEEK, failureMessage, isSuccess, THINKING_OFF } from "./provider";
import { recordStat, type RequestKind } from "./requestLog";
import { readUsage } from "./stream";

const GREETING_TOKENS = 120;
/** A request body that is not streamed; only its model is read here. */
type PlainBody = { model: string; [field: string]: unknown };

/**
 * The request for one line the pet says by itself, in the character's voice.
 * `intent`: what the line is for, such as "向用户问好，开始新的一天". `now` is `localTimeText()`.
 */
export function greetingRequest(intent: string, facts: readonly string[], preferences: ChatRequestPreferences, now: string): PlainBody {
  const userName = preferences.userName.trim();
  const system = `你是一位名叫${preferences.name}的中文桌面宠物。${userName ? `称呼用户为「${userName}」。` : ""}用户希望你的性格是：${preferences.personality}`;
  const user = `现在是${now}。请用一句不超过 40 个字的话${intent}。可以自然地提到下面一两条信息，不要逐条罗列，不要加引号：\n- ${facts.join("\n- ")}`;
  return { model: preferences.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], stream: false, max_tokens: GREETING_TOKENS, ...THINKING_OFF };
}

/** A request that is not streamed, recorded like every other: its timing, and the tokens its reply reports. */
async function complete(kind: RequestKind, body: PlainBody): Promise<Completion> {
  const startedAt = Date.now();
  const result = await llmPlatform.complete(DEEPSEEK.id, body);
  const ok = result.ok && isSuccess(result.status);
  let usage = null;
  try { usage = readUsage((JSON.parse(result.body) as { usage?: unknown }).usage); } catch { usage = null; }
  recordStat(kind, { model: body.model, startedAt, ok, status: result.status, firstTokenAt: null, usage });
  return result;
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

export async function greet(intent: string, facts: readonly string[], preferences: ChatRequestPreferences, now: string): Promise<string> {
  const result = await complete("greeting", greetingRequest(intent, facts, preferences, now));
  if (!result.ok) throw new Error("Request failed");
  const text = greetingText(result.body);
  if (!text) throw new Error("Empty reply");
  return text;
}

/** Sends a tiny message to `model`, to check the key and the model name. */
export async function testConnection(model: string): Promise<void> {
  const result = await complete("test", { model, messages: [{ role: "user", content: "你好" }], stream: false, max_tokens: 1, ...THINKING_OFF });
  if (result.ok && isSuccess(result.status)) return;
  // A one-word message cannot be rejected for its content: the model name is what is wrong.
  if (result.status === 400 || result.status === 404 || result.status === 422) throw new Error("模型名不可用，DeepSeek 不认识这个模型。");
  throw new Error(failureMessage(result.status));
}
