import { z } from "zod";

/** What the pet said by itself and when. Shared by every character, so switching does not say it again. */
const KEY = "ai-pet:companion-history:v1";
/** Long enough for "already said today" and the gaps between lines; older entries are dropped. */
const KEEP_MS = 7 * 24 * 60 * 60_000;

/** `answered`: the user reacted soon after the line, with a word or a pat. */
const saidSchema = z.object({ occasion: z.string(), subject: z.string().nullable(), at: z.number(), answered: z.boolean().optional() });
/** How long after a line a reaction from the user counts as an answer to it. */
export const ANSWER_WINDOW_MS = 5 * 60_000;
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

/** Takes a reaction from the user as an answer to the line the pet said last, if that was a moment ago. Returns whether it was. */
export function markAnswered(now: number, storage: Storage = window.localStorage): boolean {
  const history = loadHistory(storage);
  const last = history.reduce<Said | null>((latest, said) => (latest === null || said.at > latest.at ? said : latest), null);
  if (last === null || last.answered || now < last.at || now - last.at >= ANSWER_WINDOW_MS) return false;
  storage.setItem(KEY, JSON.stringify(history.map((said) => (said === last ? { ...said, answered: true } : said))));
  return true;
}

/** How many of the latest lines said for these occasions went by without an answer, back to the last one that got one. */
export function unanswered(history: readonly Said[], occasions: ReadonlySet<string>): number {
  const latestFirst = history.filter((said) => occasions.has(said.occasion)).sort((a, b) => b.at - a.at);
  const answered = latestFirst.findIndex((said) => said.answered);
  return answered === -1 ? latestFirst.length : answered;
}
