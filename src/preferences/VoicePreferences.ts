import { z } from "zod";
import type { PetPersona } from "../assets/Manifest";
import { CLONED_VOICE_PATTERN, MIMO_VOICES, PERSONA_LIMITS } from "../types";
import { CHARACTER_DATA, characterKey } from "./CharacterPreferences";

/** One of MiMo's own voices, or `clone:<id>` for one the user cloned. */
const voiceSchema = z.union([z.enum(MIMO_VOICES), z.string().regex(CLONED_VOICE_PATTERN)]);
const schema = z.object({
  autoSpeak: z.boolean().default(false),
  voice: voiceSchema.default("茉莉"),
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

/** Saved preferences may leave the voice out: a cloned voice was deleted, and the character's own voice is back. */
const savedSchema = schema.extend({ voice: voiceSchema.optional() });

export function loadVoicePreferences(packId: string, persona?: PetPersona, storage: Storage = window.localStorage): VoicePreferences {
  try {
    const raw = storage.getItem(key(packId));
    if (!raw) return voiceDefaults(persona);
    const saved = savedSchema.parse(JSON.parse(raw));
    return { ...saved, voice: saved.voice ?? voiceDefaults(persona).voice };
  }
  catch (error) { console.warn("Failed to read voice preferences", error); return voiceDefaults(persona); }
}

export function saveVoicePreferences(packId: string, value: VoicePreferences, storage: Storage = window.localStorage): void {
  storage.setItem(key(packId), JSON.stringify(schema.parse(value)));
}

/** A cloned voice was deleted: every character that used it goes back to its own voice, keeping the rest. */
export function forgetVoice(voice: string, storage: Storage = window.localStorage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((name): name is string => name?.endsWith(`:${CHARACTER_DATA.voicePreferences}`) ?? false);
  for (const name of keys) {
    try {
      const { voice: used, ...rest } = savedSchema.parse(JSON.parse(storage.getItem(name) ?? ""));
      if (used === voice) storage.setItem(name, JSON.stringify(rest));
    } catch (error) { console.warn("Skipping unreadable voice preferences", error); }
  }
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
