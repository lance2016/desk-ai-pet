import { z } from "zod";
import type { FocusSnapshot } from "../behavior/FocusTimer";

/** The running focus round. Global: switching characters keeps it going. */
const KEY = "ai-pet:focus:v1";

const schema = z.object({
  phase: z.enum(["off", "focusing", "resting"]),
  endsAt: z.number().finite().nullable(),
  minutes: z.union([z.literal(25), z.literal(50)]).optional(),
});

export function loadFocus(storage: Storage = window.localStorage): FocusSnapshot | null {
  try {
    const raw = storage.getItem(KEY);
    return raw ? schema.parse(JSON.parse(raw)) : null;
  } catch (error) {
    console.warn("Ignoring invalid focus data", error);
    return null;
  }
}

export function saveFocus(snapshot: FocusSnapshot, storage: Storage = window.localStorage): void {
  try {
    storage.setItem(KEY, JSON.stringify(schema.parse(snapshot)));
  } catch (error) {
    console.warn("Could not save the focus round", error);
  }
}
