import { z } from "zod";
import type { PetPersona } from "../assets/Manifest";
import { PERSONA_LIMITS } from "../types";
import { CHARACTER_DATA, characterKey } from "./CharacterPreferences";
import { loadChatModel } from "./ChatModel";
import { loadUserProfile } from "./UserProfile";
import { loadChatInstructions } from "./ChatInstructions";
import { loadChatRules, type ChatRules } from "./ChatRules";
import { loadDeveloperMode } from "./DeveloperMode";
const schema = z.object({ name: z.string().trim().min(1).max(PERSONA_LIMITS.name), personality: z.string().trim().max(PERSONA_LIMITS.personality), length: z.enum(["short", "normal"]) });
export type ChatPreferences = z.infer<typeof schema>;
export { schema as chatPreferencesSchema };
export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = { name: "小艾", personality: "温暖、自然，像朋友一样陪伴我", length: "short" };
const key = (packId: string) => characterKey(packId, CHARACTER_DATA.chatPreferences);
/** What a character says about itself, used until the user changes it. */
export function chatDefaults(persona?: PetPersona): ChatPreferences {
  return persona ? { ...DEFAULT_CHAT_PREFERENCES, name: persona.name, personality: persona.personality } : DEFAULT_CHAT_PREFERENCES;
}
export function loadChatPreferences(packId: string, persona?: PetPersona, storage: Storage = window.localStorage): ChatPreferences {
  try { const raw = storage.getItem(key(packId)); return raw ? schema.parse(JSON.parse(raw)) : chatDefaults(persona); }
  catch (error) { console.warn("Ignoring invalid chat preferences", error); return chatDefaults(persona); }
}
/** The name the user gave the character, or its own name when they have not renamed it. */
export function characterName(packId: string, ownName: string, storage: Storage = window.localStorage): string {
  try { const raw = storage.getItem(key(packId)); return raw ? schema.parse(JSON.parse(raw)).name : ownName; }
  catch { return ownName; }
}
/**
 * What a chat or greeting request sends: the character's preferences, how to address the user, which model answers,
 * the rule parts the user rewrote, and whether developer mode keeps the request.
 */
export type ChatRequestPreferences = ChatPreferences & { userName: string; model: string; instructions: string; rules: ChatRules; record: boolean };
export function requestPreferences(packId: string, persona?: PetPersona, storage: Storage = window.localStorage): ChatRequestPreferences {
  return { ...loadChatPreferences(packId, persona, storage), userName: loadUserProfile(storage).nickname, model: loadChatModel(storage), instructions: loadChatInstructions(packId, storage), rules: loadChatRules(storage), record: loadDeveloperMode(storage) };
}
export function saveChatPreferences(packId: string, value: ChatPreferences, storage: Storage = window.localStorage): void { storage.setItem(key(packId), JSON.stringify(schema.parse(value))); }
export function resetChatPreferences(packId: string, storage: Storage = window.localStorage): void { storage.removeItem(key(packId)); }
