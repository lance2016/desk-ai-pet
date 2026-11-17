import { z } from "zod";

const ON_TOP_KEY = "ai-pet:on-top:v1";
const KEY = "ai-pet:display-preferences:v1";
const schema = z.object({ controlsLingerMs: z.union([z.literal(400), z.literal(700), z.literal(1200)]) });
export type DisplayPreferences = z.infer<typeof schema>;
export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = { controlsLingerMs: 700 };

export function loadDisplayPreferences(): DisplayPreferences {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? schema.parse(JSON.parse(raw)) : DEFAULT_DISPLAY_PREFERENCES;
  } catch (error) {
    console.warn("Ignoring invalid display preferences", error);
    return DEFAULT_DISPLAY_PREFERENCES;
  }
}

export function saveDisplayPreferences(value: DisplayPreferences): void {
  window.localStorage.setItem(KEY, JSON.stringify(schema.parse(value)));
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(KEY);
  channel?.postMessage("changed");
  channel?.close();
}

export function subscribeDisplayPreferences(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(KEY);
  channel?.addEventListener("message", listener);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener("storage", onStorage); channel?.close(); };
}

export function loadOnTop(): boolean | null {
  const raw = window.localStorage.getItem(ON_TOP_KEY);
  return raw === "true" ? true : raw === "false" ? false : null;
}

export function saveOnTop(value: boolean): void {
  window.localStorage.setItem(ON_TOP_KEY, String(value));
}
