import { z } from "zod";
import { loadAgenda } from "../agenda/AgendaStore";
import { appearanceSchema, type AppearanceRecord } from "../appearance/AppearanceStore";
import { loadNotes } from "../notes/NoteStore";
import { EMPTY_WORK_LOG, workLogSchema, type WorkLogData } from "../worklog/WorkLog";

/**
 * One file with everything the app keeps on this computer: every
 * `ai-pet:` key in localStorage, the pictures in IndexedDB and, from version 2,
 * the work log in SQLite. API keys live in separate native storage and are not part of it.
 */
const FORMAT = "ai-pet-backup";
const VERSION = 2;
const KEY_PREFIX = "ai-pet:";
const MAX_KEY_CHARS = 300;
/** localStorage holds about 5 MB in all, so no single value can be larger. */
const MAX_VALUE_CHARS = 5_000_000;
const MAX_APPEARANCES = 500;

const backupSchema = z.object({
  format: z.literal(FORMAT),
  /** Version 1 had no work log; restoring it leaves the log empty, as it was then. */
  version: z.union([z.literal(1), z.literal(VERSION)]),
  exportedAt: z.number().finite(),
  local: z.record(z.string().startsWith(KEY_PREFIX).max(MAX_KEY_CHARS), z.string().max(MAX_VALUE_CHARS)),
  appearances: z.array(z.object({ key: z.string().min(1).max(MAX_KEY_CHARS), value: appearanceSchema })).max(MAX_APPEARANCES),
  workLog: workLogSchema.default(EMPTY_WORK_LOG),
});

export type Backup = z.infer<typeof backupSchema>;

export interface BackupSummary {
  exportedAt: number;
  reminders: number;
  notes: number;
  pictures: number;
  /** Days the work log has something for. */
  loggedDays: number;
}

/** Reads and replaces the work log; the native side keeps it. */
export interface WorkLogAccess {
  exportAll(): Promise<WorkLogData>;
  replace(log: WorkLogData): Promise<void>;
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

export function createBackup(local: Record<string, string>, appearances: readonly AppearanceRecord[], workLog: WorkLogData, now = Date.now()): Backup {
  return backupSchema.parse({ format: FORMAT, version: VERSION, exportedAt: now, local, appearances, workLog });
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
  const { events, counts } = backup.workLog;
  const loggedDays = new Set([...events.map((event) => event.day), ...counts.map((count) => count.day)]).size;
  return { exportedAt: backup.exportedAt, reminders: loadAgenda(storage).length, notes: loadNotes(storage).length, pictures: backup.appearances.length, loggedDays };
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
 * Replaces this computer's data with the backup's: the work log first, then
 * the settings, then the pictures. If a later step fails, the work log and the
 * settings go back to what they were.
 */
export async function restoreBackup(backup: Backup, replaceAppearances: (records: readonly AppearanceRecord[]) => Promise<void>, workLog: WorkLogAccess, storage: Storage = window.localStorage): Promise<void> {
  const previousLog = await workLog.exportAll();
  await workLog.replace(backup.workLog);
  const previous = localData(storage);
  try {
    replaceLocalData(backup.local, storage);
    await replaceAppearances(backup.appearances);
  } catch (error) {
    replaceLocalData(previous, storage);
    await workLog.replace(previousLog).catch((reason: unknown) => console.error("Could not put the work log back", reason));
    throw error;
  }
}
