import { z } from "zod";
import { loadFactLearning, saveFactLearning } from "../facts/FactStore";
import { CHAT_RULE_IDS, type ChatRuleId } from "./ChatRules";

/** Chat skills the user turned off in 「设置 › 能力」. Shared by all characters. */
const KEY = "ai-pet:skills-off:v1";
/** Single tools, by name, turned off in 「设置 › 工具定义」 (developer mode). Shared by all characters. */
const TOOLS_KEY = "ai-pet:tools-off:v1";
/** Remembering has had its own switch on the memory page since before this list; both pages use that one. */
const REMEMBER: ChatRuleId = "remember";
/**
 * Skills that were split into reminders, notes and the daily report. "lookup" turned "memory" off
 * with it (changing an item needed the list), so it stands for all three.
 */
const SPLIT: Record<string, readonly ChatRuleId[]> = { memory: ["reminders", "notes"], lookup: ["reminders", "notes", "review"] };
const TOOL_NAME = /^[a-z0-9_]{1,64}$/;

/** What the user turned off: whole skills, and single tools by name. */
export interface SwitchedOff { skills: readonly ChatRuleId[]; tools: readonly string[] }
export const NOTHING_OFF: SwitchedOff = { skills: [], tools: [] };

const isRuleId = (id: string): id is ChatRuleId => CHAT_RULE_IDS.some((known) => known === id);

function storedOff(storage: Storage): ChatRuleId[] {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const ids = z.array(z.string()).parse(JSON.parse(raw)).flatMap((id) => SPLIT[id] ?? (isRuleId(id) ? [id] : []));
    return [...new Set(ids)].filter((id) => id !== REMEMBER);
  } catch (error) { console.warn("Ignoring invalid skill switches", error); return []; }
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

/** The tools the user turned off one by one. A name no skill has any more is harmless and stays. */
export function loadToolsOff(storage: Storage = window.localStorage): string[] {
  try { const raw = storage.getItem(TOOLS_KEY); return raw ? z.array(z.string().regex(TOOL_NAME)).parse(JSON.parse(raw)) : []; }
  catch (error) { console.warn("Ignoring invalid tool switches", error); return []; }
}

export function saveToolOn(name: string, on: boolean, storage: Storage = window.localStorage): void {
  const others = loadToolsOff(storage).filter((other) => other !== name);
  const next = on ? others : [...others, name];
  if (next.length === 0) storage.removeItem(TOOLS_KEY);
  else storage.setItem(TOOLS_KEY, JSON.stringify(next));
}

/** Everything the user turned off, as a chat needs it. */
export const loadSwitchedOff = (storage: Storage = window.localStorage): SwitchedOff => ({ skills: loadSkillsOff(storage), tools: loadToolsOff(storage) });
