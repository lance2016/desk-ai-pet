import { z } from "zod";

/** What the pet said by itself and when. Shared by every character, so switching does not say it again. */
const KEY = "ai-pet:companion-history:v1";
/** Long enough for "already said today" and the gaps between lines; older entries are dropped. */
const KEEP_MS = 7 * 24 * 60 * 60_000;

const saidSchema = z.object({ occasion: z.string(), subject: z.string().nullable(), at: z.number() });
export type Said = z.infer<typeof saidSchema>;

export function loadHistory(storage: Storage = window.localStorage): Said[] {
  try {
    const raw = storage.getItem(KEY);
    return raw ? z.array(saidSchema).parse(JSON.parse(raw)) : [];
  } catch (error) {
    console.warn("Ignoring invalid companion history", error);
    return [];
  }
}

export function recordSaid(entry: Said, storage: Storage = window.localStorage): void {
  const kept = loadHistory(storage).filter((said) => entry.at - said.at < KEEP_MS);
  storage.setItem(KEY, JSON.stringify([...kept, entry]));
}

/** When each occasion was last spoken for, by occasion id. */
export function lastSaid(history: readonly Said[]): Record<string, number> {
  const last: Record<string, number> = {};
  for (const said of history) last[said.occasion] = Math.max(last[said.occasion] ?? 0, said.at);
  return last;
}

export function alreadySaid(history: readonly Said[], occasion: string, subject: string): boolean {
  return history.some((said) => said.occasion === occasion && said.subject === subject);
}
