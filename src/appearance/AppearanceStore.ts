import { z } from "zod";
import { MOTION_PRESETS } from "../types";

const DATABASE = "ai-pet-appearance";
const STORE = "actions";
const MAX_DATA_LENGTH = 24_000_000;
const relativePath = z.string().min(1).refine((path) => !path.startsWith("/") && !path.includes("\\") && !path.includes(":") && !path.split("/").includes(".."));
export const appearanceLayerSchema = z.object({
  name: z.string().max(30).optional(),
  source: z.union([
    z.object({ file: relativePath }),
    z.object({ image: z.string().max(6_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/) }),
  ]),
  frames: z.number().int().min(1).max(16),
  fps: z.number().min(1).max(30),
  x: z.number().finite().min(-4096).max(4096),
  y: z.number().finite().min(-4096).max(4096),
  scaleX: z.number().min(0.05).max(5),
  scaleY: z.number().min(0.05).max(5),
  rotation: z.number().min(-6.29).max(6.29),
  zIndex: z.number().int().min(-20).max(20),
  motion: z.enum(MOTION_PRESETS),
  startFrame: z.number().int().min(1).max(16).optional(),
  endFrame: z.number().int().min(1).max(16).optional(),
}).refine((layer) => !layer.startFrame || !layer.endFrame || layer.startFrame <= layer.endFrame, "Invalid visible frame range");
export type AppearanceLayer = z.infer<typeof appearanceLayerSchema>;
export const appearanceSchema = z.object({
  image: z.string().max(MAX_DATA_LENGTH).regex(/^data:image\/png;base64,/),
  frames: z.number().int().min(1).max(16),
  fps: z.number().min(1).max(30),
  motion: z.enum(MOTION_PRESETS),
  motionSpeed: z.number().min(0.25).max(3).default(1),
  motionStrength: z.number().min(0).max(2).default(1),
  loop: z.boolean(),
  layers: z.array(appearanceLayerSchema).max(8).optional(),
}).superRefine((appearance, ctx) => {
  appearance.layers?.forEach((layer, index) => {
    if ((layer.startFrame ?? 1) > appearance.frames || (layer.endFrame ?? appearance.frames) > appearance.frames) {
      ctx.addIssue({ code: "custom", path: ["layers", index], message: "Layer frame range exceeds the main animation" });
    }
  });
});
export type ActionAppearance = z.infer<typeof appearanceSchema>;

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open appearance storage"));
    request.onblocked = () => reject(new Error("Appearance storage is blocked by another window"));
  });
}

async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openStore();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      let result: T;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error("Appearance storage failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Appearance storage was interrupted"));
    });
  } finally { db.close(); }
}

const key = (packId: string, actionId: string) => JSON.stringify([packId, actionId]);
export async function loadAppearance(packId: string, actionId: string): Promise<ActionAppearance | null> {
  const value = await transact("readonly", (store) => store.get(key(packId, actionId)));
  if (value === undefined) return null;
  return appearanceSchema.parse(value);
}
export async function saveAppearance(packId: string, actionId: string, value: ActionAppearance): Promise<void> {
  const valid = appearanceSchema.parse(value);
  await transact("readwrite", (store) => store.put(valid, key(packId, actionId)));
}
export async function resetAppearance(packId: string, actionId: string): Promise<void> {
  await transact("readwrite", (store) => store.delete(key(packId, actionId)));
}

/** One stored picture as it sits in the database, for backups. */
export interface AppearanceRecord { key: string; value: ActionAppearance }

/** Every stored picture. Records that no longer parse are left out. */
export async function listAppearances(): Promise<AppearanceRecord[]> {
  const db = await openStore();
  let keys: IDBValidKey[] = [];
  let values: unknown[] = [];
  try {
    // Both reads in one transaction, so keys and values line up.
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const store = transaction.objectStore(STORE);
      const keyRequest = store.getAllKeys();
      const valueRequest = store.getAll();
      transaction.oncomplete = () => { keys = keyRequest.result; values = valueRequest.result; resolve(); };
      transaction.onerror = () => reject(transaction.error ?? new Error("Appearance storage failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Appearance storage was interrupted"));
    });
  } finally { db.close(); }
  return keys.flatMap((key, index) => {
    const parsed = appearanceSchema.safeParse(values[index]);
    if (typeof key !== "string" || !parsed.success) return [];
    return [{ key, value: parsed.data }];
  });
}

/** Replaces every stored picture in one transaction: either all of them are written or none. */
export async function replaceAppearances(records: readonly AppearanceRecord[]): Promise<void> {
  const valid = records.map((record) => ({ key: record.key, value: appearanceSchema.parse(record.value) }));
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      store.clear();
      for (const record of valid) store.put(record.value, record.key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Appearance storage failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Appearance storage was interrupted"));
    });
  } finally { db.close(); }
}

/** Adds a set of pictures atomically without replacing appearances owned by other characters. */
export async function mergeAppearances(records: readonly AppearanceRecord[]): Promise<void> {
  const valid = records.map((record) => ({ key: record.key, value: appearanceSchema.parse(record.value) }));
  const db = await openStore();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      for (const record of valid) store.put(record.value, record.key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Appearance storage failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Appearance storage was interrupted"));
    });
  } finally { db.close(); }
}
