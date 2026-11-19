import { z } from "zod";
import { characterKey, CHARACTER_DATA } from "./CharacterPreferences";

export const CHAT_INSTRUCTIONS_LIMIT = 500;
const schema = z.string().max(CHAT_INSTRUCTIONS_LIMIT);
const key = (packId: string) => characterKey(packId, CHARACTER_DATA.chatInstructions);

export function loadChatInstructions(packId: string, storage: Storage = window.localStorage): string {
  try { const value = storage.getItem(key(packId)); return value === null ? "" : schema.parse(JSON.parse(value)); }
  catch (error) { console.warn("Ignoring invalid chat instructions", error); return ""; }
}
export function saveChatInstructions(packId: string, value: string, storage: Storage = window.localStorage): void {
  storage.setItem(key(packId), JSON.stringify(schema.parse(value)));
}
