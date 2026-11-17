import { DEFAULT_PACK_ID, PACK_ID_PATTERN } from "../assets/PackCatalog";

const ACTIVE_KEY = "ai-pet:active-character:v1";

/**
 * Data that belongs to one character, by the name it is stored under
 * (see `characterKey`). Before characters existed these lived in global keys;
 * they are moved to the default character once.
 */
export const CHARACTER_DATA = {
  pet: "pet",
  chatPreferences: "chat-preferences:v1",
  chatHistory: "chat-history:v1",
  chatThreads: "chat-threads:v1",
  chatAppearance: "chat-appearance:v1",
  voicePreferences: "voice-preferences:v1",
  controlPreferences: "control-preferences:v1",
  actionShortcuts: "action-shortcuts:v1",
  disabledIdleActions: "disabled-idle-actions:v1",
  /** The dock as one ordered list; replaces controlPreferences and actionShortcuts, which are read once to migrate. */
  dock: "dock:v1",
  /** Actions the user made in the action library; their pictures are in AppearanceStore. */
  userActions: "user-actions:v1",
} as const;

const LEGACY_PREFIX = "ai-pet:";

/** Storage key of one piece of one character's data. */
export function characterKey(packId: string, name: string): string {
  return `ai-pet:character:${packId}:${name}`;
}

/** Removes every piece of data stored under `characterKey` for one character. */
export function clearCharacterData(packId: string, storage: Storage = window.localStorage): void {
  const prefix = characterKey(packId, "");
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key?.startsWith(prefix) ?? false);
  keys.forEach((key) => storage.removeItem(key));
}

/** Moves data saved before characters existed to the default character. Safe to run in every window. */
export function migrateLegacyCharacterData(storage: Storage = window.localStorage): void {
  for (const name of Object.values(CHARACTER_DATA)) {
    const legacyKey = `${LEGACY_PREFIX}${name}`;
    const value = storage.getItem(legacyKey);
    if (value === null) continue;
    const key = characterKey(DEFAULT_PACK_ID, name);
    if (storage.getItem(key) === null) storage.setItem(key, value);
    storage.removeItem(legacyKey);
  }
}

export function loadActiveCharacter(storage: Storage = window.localStorage): string {
  try {
    const id = storage.getItem(ACTIVE_KEY);
    return id !== null && PACK_ID_PATTERN.test(id) ? id : DEFAULT_PACK_ID;
  } catch (error) {
    console.warn("Failed to read the active character", error);
    return DEFAULT_PACK_ID;
  }
}

export function saveActiveCharacter(id: string, storage: Storage = window.localStorage): void {
  if (!PACK_ID_PATTERN.test(id)) throw new Error(`Invalid character id "${id}"`);
  storage.setItem(ACTIVE_KEY, id);
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(ACTIVE_KEY);
  channel.postMessage("changed");
  channel.close();
}

export function subscribeActiveCharacter(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === ACTIVE_KEY || event.key === null) listener(); };
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(ACTIVE_KEY);
  channel?.addEventListener("message", listener);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener("storage", onStorage); channel?.close(); };
}
