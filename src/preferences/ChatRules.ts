import { z } from "zod";

/** Counted in UTF-16 like the textarea. */
export const CHAT_RULE_LIMIT = 2000;
/** The parts of the chat rules the user may rewrite; see `chatSections` in `src/ai/prompt.ts`. */
export const CHAT_RULE_IDS = ["reminders", "notes", "review", "remember", "quiet", "actions"] as const;
export type ChatRuleId = (typeof CHAT_RULE_IDS)[number];

const text = z.string().max(CHAT_RULE_LIMIT);
/** Parts of skills that were since split up ("memory", "lookup") are dropped: their wording no longer fits one part. */
const schema = z.object({ reminders: text.optional(), notes: text.optional(), review: text.optional(), remember: text.optional(), quiet: text.optional(), actions: text.optional() });
/** The user's wording of each part they rewrote; a part left out uses the app's default. Shared by all characters. */
export type ChatRules = z.infer<typeof schema>;
const KEY = "ai-pet:chat-rules:v1";

export function loadChatRules(storage: Storage = window.localStorage): ChatRules {
  try { const raw = storage.getItem(KEY); return raw ? schema.parse(JSON.parse(raw)) : {}; }
  catch (error) { console.warn("Ignoring invalid chat rules", error); return {}; }
}

/** Saves `value` as the wording of one part, or goes back to the default with null. */
export function saveChatRule(id: ChatRuleId, value: string | null, storage: Storage = window.localStorage): ChatRules {
  const { [id]: _replaced, ...others } = loadChatRules(storage);
  const next = schema.parse(value === null ? others : { ...others, [id]: value });
  if (Object.keys(next).length === 0) storage.removeItem(KEY);
  else storage.setItem(KEY, JSON.stringify(next));
  return next;
}
