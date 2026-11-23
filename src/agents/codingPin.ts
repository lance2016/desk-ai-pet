import { z } from "zod";
import { SESSION_LIMITS } from "./CodingSession";

/** The folder the user pinned in the coding panel: it goes first and opens by default. */
const KEY = "ai-pet:coding-pinned:v1";

const pinSchema = z.string().min(1).max(SESSION_LIMITS.name);

export function loadPinnedFolder(storage: Storage = window.localStorage): string | null {
  const parsed = pinSchema.safeParse(storage.getItem(KEY));
  return parsed.success ? parsed.data : null;
}

/** Pins `project`, or takes the pin off with null. */
export function savePinnedFolder(project: string | null, storage: Storage = window.localStorage): void {
  if (project === null) storage.removeItem(KEY);
  else storage.setItem(KEY, pinSchema.parse(project));
}
