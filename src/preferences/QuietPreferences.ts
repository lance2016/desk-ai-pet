import { z } from "zod";

/** When the pet should keep quiet. A global setting, shared by every character. */
const KEY = "ai-pet:quiet-preferences:v1";
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const schema = z.object({
  /** Switched from the pet menu; quiet until switched off. */
  doNotDisturb: z.boolean(),
  /** Quiet every day between `start` and `end` ("HH:mm", local time). May run past midnight. */
  quietHours: z.object({ enabled: z.boolean(), start: timeSchema, end: timeSchema }),
});
export type QuietPreferences = z.infer<typeof schema>;
export const DEFAULT_QUIET_PREFERENCES: QuietPreferences = {
  doNotDisturb: false,
  quietHours: { enabled: true, start: "23:00", end: "08:00" },
};

/** "HH:mm" to minutes since midnight. */
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** True when the pet should not speak up on its own at `now`. */
export function isQuietAt(preferences: QuietPreferences, now: number): boolean {
  if (preferences.doNotDisturb) return true;
  const { enabled, start, end } = preferences.quietHours;
  if (!enabled) return false;
  const date = new Date(now);
  const minute = date.getHours() * 60 + date.getMinutes();
  const from = minutesOf(start);
  const to = minutesOf(end);
  return from <= to ? minute >= from && minute < to : minute >= from || minute < to;
}

export function loadQuietPreferences(storage: Storage = window.localStorage): QuietPreferences {
  try {
    const raw = storage.getItem(KEY);
    return raw ? schema.parse(JSON.parse(raw)) : DEFAULT_QUIET_PREFERENCES;
  } catch (error) {
    console.warn("Ignoring invalid quiet preferences", error);
    return DEFAULT_QUIET_PREFERENCES;
  }
}

export function saveQuietPreferences(value: QuietPreferences, storage: Storage = window.localStorage): void {
  storage.setItem(KEY, JSON.stringify(schema.parse(value)));
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(KEY);
  channel.postMessage("changed");
  channel.close();
}

export function subscribeQuietPreferences(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(KEY);
  channel?.addEventListener("message", listener);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener("storage", onStorage); channel?.close(); };
}
