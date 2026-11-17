import { z } from "zod";
import { loadAgenda } from "../agenda/AgendaStore";
import { appearanceSchema, type AppearanceRecord } from "../appearance/AppearanceStore";
import { loadNotes } from "../notes/NoteStore";

/**
 * One file with everything the app keeps on this computer: every
 * `ai-pet:` key in localStorage plus the pictures in IndexedDB. API keys live
 * in the macOS keychain and are not part of it.
 */
const FORMAT = "ai-pet-backup";
const VERSION = 1;
const KEY_PREFIX = "ai-pet:";
const MAX_KEY_CHARS = 300;
/** localStorage holds about 5 MB in all, so no single value can be larger. */
const MAX_VALUE_CHARS = 5_000_000;
const MAX_APPEARANCES = 500;

const backupSchema = z.object({
  format: z.literal(FORMAT),
  version: z.literal(VERSION),
  exportedAt: z.number().finite(),
  local: z.record(z.string().startsWith(KEY_PREFIX).max(MAX_KEY_CHARS), z.string().max(MAX_VALUE_CHARS)),
  appearances: z.array(z.object({ key: z.string().min(1).max(MAX_KEY_CHARS), value: appearanceSchema })).max(MAX_APPEARANCES),
});

export type Backup = z.infer<typeof backupSchema>;

export interface BackupSummary {
  exportedAt: number;
  reminders: number;
  notes: number;
  pictures: number;
}

/** Every value the app saved in `storage`. */
export function localData(storage: Storage = window.localStorage): Record<string, string> {
  const entries: Array<[string, string]> = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    const value = key === null ? null : storage.getItem(key);
    if (key?.startsWith(KEY_PREFIX) && value !== null) entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

export function createBackup(local: Record<string, string>, appearances: readonly AppearanceRecord[], now = Date.now()): Backup {
  return backupSchema.parse({ format: FORMAT, version: VERSION, exportedAt: now, local, appearances });
}

export function backupFileName(now = Date.now()): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `AI Pet 备份 ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

/** Reads a backup file. Throws when it is not one, or is damaged. */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("The file is not JSON");
  }
  return backupSchema.parse(raw);
}

/** A read-only Storage over the backup's values, so the stores' own loaders can count them. */
function readOnlyStorage(values: Record<string, string>): Storage {
  const keys = Object.keys(values);
  return {
    get length() { return keys.length; },
    key: (index) => keys[index] ?? null,
    getItem: (key) => values[key] ?? null,
    setItem: () => { throw new Error("Read-only"); },
    removeItem: () => { throw new Error("Read-only"); },
    clear: () => { throw new Error("Read-only"); },
  };
}

export function summarizeBackup(backup: Backup): BackupSummary {
  const storage = readOnlyStorage(backup.local);
  return { exportedAt: backup.exportedAt, reminders: loadAgenda(storage).length, notes: loadNotes(storage).length, pictures: backup.appearances.length };
}

/** Makes `storage` hold exactly `values` among the app's keys. Puts the old values back if writing fails. */
export function replaceLocalData(values: Record<string, string>, storage: Storage = window.localStorage): void {
  const previous = localData(storage);
  const write = (next: Record<string, string>) => {
    for (const key of Object.keys(localData(storage))) storage.removeItem(key);
    for (const [key, value] of Object.entries(next)) storage.setItem(key, value);
  };
  try {
    write(values);
  } catch (error) {
    write(previous);
    throw error;
  }
}

/**
 * Replaces this computer's data with the backup's. The pictures are written
 * after the settings; if they fail, the settings go back to what they were.
 */
export async function restoreBackup(backup: Backup, replaceAppearances: (records: readonly AppearanceRecord[]) => Promise<void>, storage: Storage = window.localStorage): Promise<void> {
  const previous = localData(storage);
  replaceLocalData(backup.local, storage);
  try {
    await replaceAppearances(backup.appearances);
  } catch (error) {
    replaceLocalData(previous, storage);
    throw error;
  }
}
