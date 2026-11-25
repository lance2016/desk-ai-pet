import { z } from "zod";
import { DEFAULT_FOCUS_MINUTES, type FocusMinutes } from "../behavior/FocusTimer";

/** How long a focus round runs. Global, like the running round; the pet reads it each time one starts. */
const KEY = "ai-pet:focus-preferences:v1";
const schema = z.object({ minutes: z.union([z.literal(25), z.literal(50)]) });
export interface FocusPreferences { minutes: FocusMinutes }
const DEFAULT_FOCUS_PREFERENCES: FocusPreferences = { minutes: DEFAULT_FOCUS_MINUTES };

export function loadFocusPreferences(storage: Storage = window.localStorage): FocusPreferences {
  try {
    const raw = storage.getItem(KEY);
    return raw ? schema.parse(JSON.parse(raw)) : DEFAULT_FOCUS_PREFERENCES;
  } catch (error) {
    console.warn("Ignoring invalid focus preferences", error);
    return DEFAULT_FOCUS_PREFERENCES;
  }
}

export function saveFocusPreferences(value: FocusPreferences, storage: Storage = window.localStorage): void {
  storage.setItem(KEY, JSON.stringify(schema.parse(value)));
}
