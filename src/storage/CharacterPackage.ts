import { z } from "zod";
import { userActionListSchema } from "../actions/UserActions";
import { characterKey, CHARACTER_DATA } from "../preferences/CharacterPreferences";
import { chatPreferencesSchema } from "../preferences/ChatPreferences";
import { appearanceSchema, mergeAppearances, type AppearanceRecord } from "../appearance/AppearanceStore";
import { createCustomCharacter, deleteCustomCharacter, isCustomCharacter, loadCharacterPack, loadCustomCharacters, PACK_ID_PATTERN } from "../assets/PackCatalog";
import { PERSONA_LIMITS } from "../types";

const FORMAT = "ai-pet-character";
const VERSION = 1;
const MAX_PREFERENCE_CHARS = 5_000_000;
const MAX_APPEARANCES = 100;
const ACTION_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const MAX_CHARACTER_PACKAGE_BYTES = 80 * 1024 * 1024;

/** Character settings that make sense on another computer; personal progress and conversations stay out. */
export const PORTABLE_CHARACTER_DATA = [
  CHARACTER_DATA.chatPreferences,
  CHARACTER_DATA.chatInstructions,
  CHARACTER_DATA.chatAppearance,
  CHARACTER_DATA.voicePreferences,
  CHARACTER_DATA.controlPreferences,
  CHARACTER_DATA.actionShortcuts,
  CHARACTER_DATA.disabledIdleActions,
  CHARACTER_DATA.dock,
  CHARACTER_DATA.userActions,
  CHARACTER_DATA.artPrompts,
] as const;

const portableDataName = z.enum(PORTABLE_CHARACTER_DATA);
const packageSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(VERSION),
  exportedAt: z.number().finite(),
  character: z.object({
    base: z.string().regex(PACK_ID_PATTERN),
    name: z.string().trim().min(1).max(PERSONA_LIMITS.name),
    personality: z.string().max(PERSONA_LIMITS.personality),
  }).strict().refine((character) => !isCustomCharacter(character.base), "A character package must use a built-in base"),
  // A character saves only the settings it changed, so any of them may be missing.
  preferences: z.partialRecord(portableDataName,z.string().max(MAX_PREFERENCE_CHARS)),
  appearances: z.array(z.object({
    actionId: z.string().regex(ACTION_ID_PATTERN),
    value: appearanceSchema,
  }).strict()).max(MAX_APPEARANCES),
}).strict().superRefine((characterPackage, context) => {
  const rawActions = characterPackage.preferences[CHARACTER_DATA.userActions];
  if (rawActions === undefined) return;
  try {
    userActionListSchema.parse(JSON.parse(rawActions));
  } catch {
    context.addIssue({ code: "custom", path: ["preferences", CHARACTER_DATA.userActions], message: "Invalid user actions" });
  }
});

export type CharacterPackage = z.infer<typeof packageSchema>;

export interface CharacterPackageSummary {
  name: string;
  actions: number;
  customActions: number;
  layeredActions: number;
}

/** Creates a portable file for one user-created character. Chat history and pet stats are intentionally excluded. */
export function createCharacterPackage(
  packId: string,
  localAppearances: readonly AppearanceRecord[],
  storage: Storage = window.localStorage,
  now = Date.now(),
): CharacterPackage {
  const character = loadCustomCharacters(storage).find((entry) => entry.id === packId);
  if (!character) throw new Error("Only a user-created character can be exported");

  const preferences = Object.fromEntries(PORTABLE_CHARACTER_DATA.flatMap((name) => {
    const value = storage.getItem(characterKey(packId, name));
    return value === null ? [] : [[name, value]];
  }));
  const appearances = localAppearances.flatMap((record) => {
    try {
      const parsed = JSON.parse(record.key) as unknown;
      if (!Array.isArray(parsed) || parsed.length !== 2 || parsed[0] !== packId || typeof parsed[1] !== "string") return [];
      return [{ actionId: parsed[1], value: record.value }];
    } catch {
      return [];
    }
  });

  return packageSchema.parse({
    format: FORMAT,
    version: VERSION,
    exportedAt: now,
    character: { base: character.base, name: character.name, personality: character.personality },
    preferences,
    appearances,
  });
}

/** Parses and validates a portable character file before any local data is changed. */
export function parseCharacterPackage(text: string): CharacterPackage {
  if (new TextEncoder().encode(text).byteLength > MAX_CHARACTER_PACKAGE_BYTES) {
    throw new Error("The character package is too large");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The file is not JSON");
  }
  return packageSchema.parse(raw);
}

export function characterPackageText(characterPackage: CharacterPackage): string {
  const text = JSON.stringify(packageSchema.parse(characterPackage));
  if (new TextEncoder().encode(text).byteLength > MAX_CHARACTER_PACKAGE_BYTES) {
    throw new Error("The character package is too large");
  }
  return text;
}

/** The character's chat settings in the package, when it has valid ones. */
function packagedChatPreferences(characterPackage: CharacterPackage) {
  const raw = characterPackage.preferences[CHARACTER_DATA.chatPreferences];
  if (raw === undefined) return null;
  try {
    return chatPreferencesSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The name the character goes by: the one the user changed it to, or the one it was created with. */
function packagedName(characterPackage: CharacterPackage): string {
  return packagedChatPreferences(characterPackage)?.name ?? characterPackage.character.name;
}

/** `name`, or `name 2`, `name 3`… when another character already uses it. Stays within the name limit. */
export function uniqueCharacterName(name: string, taken: readonly string[]): string {
  if (!taken.includes(name)) return name;
  for (let number = 2; ; number += 1) {
    const suffix = ` ${number}`;
    const candidate = `${name.slice(0, PERSONA_LIMITS.name - suffix.length)}${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** A copy of the package whose character goes by `name`, both as created and in its chat settings. */
export function renameCharacterPackage(characterPackage: CharacterPackage, name: string): CharacterPackage {
  const chat = packagedChatPreferences(characterPackage);
  const preferences = chat
    ? { ...characterPackage.preferences, [CHARACTER_DATA.chatPreferences]: JSON.stringify({ ...chat, name }) }
    : characterPackage.preferences;
  return packageSchema.parse({ ...characterPackage, character: { ...characterPackage.character, name }, preferences });
}

export function summarizeCharacterPackage(characterPackage: CharacterPackage): CharacterPackageSummary {
  const rawActions = characterPackage.preferences[CHARACTER_DATA.userActions];
  const customActions = rawActions ? userActionListSchema.parse(JSON.parse(rawActions)).length : 0;
  return {
    name: packagedName(characterPackage),
    actions: characterPackage.appearances.length,
    customActions,
    layeredActions: characterPackage.appearances.filter((appearance) => (appearance.value.layers?.length ?? 0) > 0).length,
  };
}

/** Imports a new copy of the character. Its files and action settings get a fresh local character id. */
export async function importCharacterPackage(
  characterPackage: CharacterPackage,
  storage: Storage = window.localStorage,
): Promise<string> {
  const valid = packageSchema.parse(characterPackage);
  if (isCustomCharacter(valid.character.base)) throw new Error("A character package must use a built-in base");
  await loadCharacterPack(valid.character.base, storage);

  const created = createCustomCharacter(valid.character, storage);
  try {
    for (const [name, value] of Object.entries(valid.preferences)) {
      storage.setItem(characterKey(created.id, name), value);
    }
    await mergeAppearances(valid.appearances.map(({ actionId, value }) => ({
      key: JSON.stringify([created.id, actionId]),
      value,
    })));
    return created.id;
  } catch (error) {
    deleteCustomCharacter(created.id, storage);
    const prefix = characterKey(created.id, "");
    for (const key of Array.from({ length: storage.length }, (_, index) => storage.key(index))) {
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
    throw error;
  }
}

export function characterPackageFileName(name: string): string {
  const safeName = name.trim().replace(/[\\/:*?"<>|]/g, "-").slice(0, PERSONA_LIMITS.name) || "角色";
  return `AI Pet 角色 ${safeName}.json`;
}
