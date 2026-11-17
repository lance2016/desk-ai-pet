import type { z } from "zod";

/**
 * Reads a saved list item by item: one bad entry is dropped instead of the
 * whole list reading as empty (and being overwritten by the next save). When
 * the text cannot be read as a list at all, it is copied to `<key>:broken`
 * first, so nothing is lost; that key starts with `ai-pet:`, so backups keep it.
 */
export function readList<Item>(storage: Storage, key: string, itemSchema: z.ZodType<Item>, limit: number): Item[] {
  const raw = storage.getItem(key);
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(`Saved ${key} is not readable; keeping a copy`, error);
    keepBroken(storage, key, raw);
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn(`Saved ${key} is not a list; keeping a copy`);
    keepBroken(storage, key, raw);
    return [];
  }
  const items: Item[] = [];
  for (const entry of parsed) {
    const result = itemSchema.safeParse(entry);
    if (result.success) items.push(result.data);
    else console.warn(`Dropping an invalid entry of ${key}`, result.error);
  }
  return items.slice(0, limit);
}

function keepBroken(storage: Storage, key: string, raw: string): void {
  try {
    storage.setItem(`${key}:broken`, raw);
  } catch (error) {
    console.error(`Could not keep a copy of ${key}`, error);
  }
}
