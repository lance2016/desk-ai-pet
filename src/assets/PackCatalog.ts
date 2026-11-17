import { z } from "zod";
import { PERSONA_LIMITS } from "../types";
import { loadAssetPack, type AssetPack } from "./AssetLoader";

/** Directory that holds the built-in character packs and their `index.json`. */
const PETS_URL = "/pets";
const CATALOG_URL = `${PETS_URL}/index.json`;

/** Pack used before the user picks a character, and the owner of pre-character saved data. */
export const DEFAULT_PACK_ID = "girl-default";
/** Pack ids double as directory names and storage-key segments, so they stay plain. */
export const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Action whose image stands for the character in lists and the chat window. */
export const PORTRAIT_ACTION = "idle";

/** Characters the user made: a name and personality wearing a built-in character's looks. */
const CUSTOM_KEY = "ai-pet:custom-characters:v1";
const CUSTOM_ID_PREFIX = "custom-";
const CUSTOM_ID_PATTERN = /^custom-[a-z0-9]{6,32}$/;
const MAX_CUSTOM_CHARACTERS = 20;

const catalogSchema = z.object({ packs: z.array(z.string().regex(PACK_ID_PATTERN)).min(1) });
const customSchema = z.object({
  id: z.string().regex(CUSTOM_ID_PATTERN),
  base: z.string().regex(PACK_ID_PATTERN),
  name: z.string().trim().min(1).max(PERSONA_LIMITS.name),
  personality: z.string().trim().max(PERSONA_LIMITS.personality),
  createdAt: z.number(),
});
const customListSchema = z.array(customSchema).max(MAX_CUSTOM_CHARACTERS);

export type CustomCharacter = z.infer<typeof customSchema>;

export interface CatalogEntry {
  id: string;
  /** The character's own name, before any rename in settings. */
  name: string;
  /** Image URL of each action, for pictures picked in settings. */
  actionImages: Record<string, string>;
  custom: boolean;
}

export function packUrl(id: string): string {
  return `${PETS_URL}/${id}`;
}

export function isCustomCharacter(id: string): boolean {
  return id.startsWith(CUSTOM_ID_PREFIX);
}

export function loadCustomCharacters(storage: Storage = window.localStorage): CustomCharacter[] {
  try {
    const raw = storage.getItem(CUSTOM_KEY);
    return raw ? customListSchema.parse(JSON.parse(raw)) : [];
  } catch (error) {
    console.warn("Ignoring an unreadable list of custom characters", error);
    return [];
  }
}

function newCustomId(): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "") ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${CUSTOM_ID_PREFIX}${random.slice(0, 12)}`;
}

/** Saves a new character. Throws on invalid input or when the list is full. */
export function createCustomCharacter(
  input: { base: string; name: string; personality: string },
  storage: Storage = window.localStorage,
  now = Date.now(),
  id = newCustomId(),
): CustomCharacter {
  const character = customSchema.parse({ ...input, id, createdAt: now });
  const list = loadCustomCharacters(storage);
  if (list.length >= MAX_CUSTOM_CHARACTERS) throw new Error(`At most ${MAX_CUSTOM_CHARACTERS} custom characters`);
  storage.setItem(CUSTOM_KEY, JSON.stringify(customListSchema.parse([...list, character])));
  return character;
}

export function deleteCustomCharacter(id: string, storage: Storage = window.localStorage): void {
  const list = loadCustomCharacters(storage);
  storage.setItem(CUSTOM_KEY, JSON.stringify(list.filter((character) => character.id !== id)));
}

async function loadBuiltInPack(id: string): Promise<AssetPack> {
  if (!PACK_ID_PATTERN.test(id)) throw new Error(`Invalid character id "${id}"`);
  const pack = await loadAssetPack(packUrl(id));
  if (pack.manifest.id !== id) {
    throw new Error(`Pet manifest id "${pack.manifest.id}" does not match its directory "${id}"`);
  }
  return pack;
}

/**
 * Loads a character. A built-in manifest id must match its directory, since both key saved data;
 * a custom character takes its base pack and swaps in its own id and persona.
 */
export async function loadCharacterPack(id: string, storage?: Storage): Promise<AssetPack> {
  if (!isCustomCharacter(id)) return loadBuiltInPack(id);
  const character = loadCustomCharacters(storage ?? window.localStorage).find((entry) => entry.id === id);
  if (!character) throw new Error(`Unknown character "${id}"`);
  const base = await loadBuiltInPack(character.base);
  const persona = { ...base.manifest.persona, name: character.name, personality: character.personality };
  return { ...base, manifest: { ...base.manifest, id: character.id, persona } };
}

/** Image URL of each action in a pack. */
export function actionImages(pack: AssetPack): Record<string, string> {
  return Object.fromEntries(pack.manifest.animations.map((action) => [action.id, pack.resolve(action.file)]));
}

function catalogEntry(id: string, pack: AssetPack, custom: boolean): CatalogEntry {
  return { id, name: pack.manifest.persona?.name ?? pack.manifest.name, actionImages: actionImages(pack), custom };
}

/** Lists the built-in characters, then the user's own. Characters that fail to load are skipped with a warning. */
export async function loadPackCatalog(storage: Storage = window.localStorage): Promise<CatalogEntry[]> {
  const response = await fetch(CATALOG_URL);
  if (!response.ok) throw new Error(`Failed to load pet catalog (HTTP ${response.status})`);
  const { packs } = catalogSchema.parse(await response.json());
  const ids = [...new Set(packs), ...loadCustomCharacters(storage).map((character) => character.id)];
  const entries = await Promise.all(ids.map(async (id) => {
    try {
      return catalogEntry(id, await loadCharacterPack(id, storage), isCustomCharacter(id));
    } catch (error) {
      console.warn(`Skipping character "${id}"`, error);
      return null;
    }
  }));
  return entries.filter((entry): entry is CatalogEntry => entry !== null);
}
