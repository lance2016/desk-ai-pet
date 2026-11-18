import { z } from "zod";
import { CHARACTER_DATA, characterKey } from "./CharacterPreferences";

const schema = z.record(z.string().min(1).max(64), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
const keyFor = (packId: string) => characterKey(packId, CHARACTER_DATA.actionTriggerStats);

/** Counts action starts from this version onward; older action events are not imported. */
export function loadActionTriggerStats(packId: string, storage: Storage = window.localStorage): Record<string, number> {
  try {
    const raw = storage.getItem(keyFor(packId));
    return raw === null ? {} : schema.parse(JSON.parse(raw));
  } catch (error) {
    console.warn("Ignoring invalid action trigger statistics", error);
    return {};
  }
}

/** Records one action only after ActionController has started it. */
export function recordActionTrigger(packId: string, actionId: string, storage: Storage = window.localStorage): void {
  const id = z.string().min(1).max(64).parse(actionId);
  const stats = loadActionTriggerStats(packId, storage);
  stats[id] = Math.min(Number.MAX_SAFE_INTEGER, (stats[id] ?? 0) + 1);
  storage.setItem(keyFor(packId), JSON.stringify(schema.parse(stats)));
}

/** Keeps the settings window in step with action starts in the pet window. */
export function subscribeActionTriggerStats(packId: string, listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const key = keyFor(packId);
  const onStorage = (event: StorageEvent) => { if (event.key === key || event.key === null) listener(); };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
