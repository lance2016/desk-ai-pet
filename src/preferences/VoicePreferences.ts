import { z } from "zod";
import type { PetPersona } from "../assets/Manifest";
import { MIMO_VOICES, PERSONA_LIMITS } from "../types";
import { CHARACTER_DATA, characterKey } from "./CharacterPreferences";

const schema = z.object({
  autoSpeak: z.boolean().default(false),
  voice: z.enum(MIMO_VOICES).default("茉莉"),
  style: z.string().max(PERSONA_LIMITS.voiceStyle).default("温柔、自然、亲切的年轻女声，语速适中，像熟悉的朋友在轻声陪伴。"),
  language: z.enum(["auto", "zh", "en"]).default("auto"),
});
export type VoicePreferences = z.infer<typeof schema>;
export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = schema.parse({});
const key = (packId: string) => characterKey(packId, CHARACTER_DATA.voicePreferences);

/** The character's own voice, used until the user changes it. */
export function voiceDefaults(persona?: PetPersona): VoicePreferences {
  return {
    ...DEFAULT_VOICE_PREFERENCES,
    ...(persona?.voice ? { voice: persona.voice } : {}),
    ...(persona?.voiceStyle !== undefined ? { style: persona.voiceStyle } : {}),
  };
}

export function loadVoicePreferences(packId: string, persona?: PetPersona, storage: Storage = window.localStorage): VoicePreferences {
  try { const raw = storage.getItem(key(packId)); return raw ? schema.parse(JSON.parse(raw)) : voiceDefaults(persona); }
  catch (error) { console.warn("Failed to read voice preferences", error); return voiceDefaults(persona); }
}

export function saveVoicePreferences(packId: string, value: VoicePreferences, storage: Storage = window.localStorage): void {
  storage.setItem(key(packId), JSON.stringify(schema.parse(value)));
}

export function resetVoicePreferences(packId: string, storage: Storage = window.localStorage): void {
  storage.removeItem(key(packId));
}

export type VoiceLanguage = VoicePreferences["language"];
/** The language the user speaks is theirs, not a character's: one setting for all. */
const LANGUAGE_KEY = "ai-pet:voice-language:v1";
const languageSchema = schema.shape.language;

/**
 * The speech recognition language. Before it was global it was kept per
 * character; until it is saved once, the current character's old choice counts.
 */
export function loadVoiceLanguage(packId: string, storage: Storage = window.localStorage): VoiceLanguage {
  try {
    const raw = storage.getItem(LANGUAGE_KEY);
    if (raw !== null) return languageSchema.parse(raw);
  } catch (error) {
    console.warn("Ignoring the saved voice language", error);
  }
  return loadVoicePreferences(packId, undefined, storage).language;
}

export function saveVoiceLanguage(language: VoiceLanguage, storage: Storage = window.localStorage): void {
  storage.setItem(LANGUAGE_KEY, languageSchema.parse(language));
}
