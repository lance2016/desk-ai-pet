import { z } from "zod";
import { loadFactLearning, saveFactLearning } from "../facts/FactStore";
import { CHAT_RULE_IDS, type ChatRuleId } from "./ChatRules";

/** Chat skills the user turned off in 「设置 › 能力」. Shared by all characters. */
const KEY = "ai-pet:skills-off:v1";
const schema = z.array(z.enum(CHAT_RULE_IDS));
/** Remembering has had its own switch on the memory page since before this list; both pages use that one. */
const REMEMBER: ChatRuleId = "remember";

function storedOff(storage: Storage): ChatRuleId[] {
  try { const raw = storage.getItem(KEY); return raw ? schema.parse(JSON.parse(raw)).filter((id) => id !== REMEMBER) : []; }
  catch (error) { console.warn("Ignoring invalid skill switches", error); return []; }
}

/** The skills the user turned off, in the order they were turned off. */
export function loadSkillsOff(storage: Storage = window.localStorage): ChatRuleId[] {
  const off = storedOff(storage);
  return loadFactLearning(storage) ? off : [...off, REMEMBER];
}

export function saveSkillOn(id: ChatRuleId, on: boolean, storage: Storage = window.localStorage): void {
  if (id === REMEMBER) { saveFactLearning(on, storage); return; }
  const others = storedOff(storage).filter((other) => other !== id);
  const next = on ? others : [...others, id];
  if (next.length === 0) storage.removeItem(KEY);
  else storage.setItem(KEY, JSON.stringify(next));
}
