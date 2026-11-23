import { z } from "zod";
import { readList } from "../storage/listStorage";
import { SESSION_LIMITS, type CodingSession, type PastTurn } from "./CodingSession";

export const SNOOZE_MS = 30 * 60_000;
const KEY = "ai-pet:coding-inbox-marks:v1";
const MAX_MARKS = SESSION_LIMITS.kept * (SESSION_LIMITS.earlier + 1);
const markSchema = z.object({ key: z.string().max(SESSION_LIMITS.id + 32), until: z.number().nonnegative() });
type InboxMark = z.infer<typeof markSchema>;

export interface InboxItem {
  key: string;
  session: CodingSession;
  turn: "waiting" | "failed" | "completed";
  at: number;
  task?: string;
  line?: string;
}

function resultItem(session: CodingSession, { turn, endedAt, task, result }: PastTurn): InboxItem | undefined {
  if (endedAt === undefined || (turn !== "failed" && turn !== "completed")) return;
  return { key: `${session.id}:${endedAt}`, session, turn, at: endedAt, task, line: result };
}

const rank = { waiting: 0, failed: 1, completed: 2 };

/** Waiting follows the live turn. Read and snoozed results are tracked per round. */
export function codingInbox(sessions: readonly CodingSession[], marks: readonly InboxMark[], now: number) {
  const byKey = new Map(marks.map(({ key, until }) => [key, until]));
  const results = new Map<string, InboxItem>();
  const pending: InboxItem[] = [];
  const later: InboxItem[] = [];
  for (const session of sessions) {
    if (session.turn === "waiting" && !session.ended) {
      pending.push({ key: `waiting:${session.id}`, session, turn: "waiting", at: session.lastEventAt, task: session.task, line: session.asking });
    }
    for (const turn of [...(session.earlier ?? []), { ...session, endedAt: session.turnEndedAt }]) {
      const item = resultItem(session, turn);
      if (item) results.set(item.key, item);
    }
  }
  for (const item of results.values()) {
    const until = byKey.get(item.key);
    if (until === 0) continue;
    (until !== undefined && until > now ? later : pending).push(item);
  }
  pending.sort((a, b) => rank[a.turn] - rank[b.turn] || (a.turn === "waiting" ? a.at - b.at : b.at - a.at));
  later.sort((a, b) => b.at - a.at);
  return { pending, later, keys: new Set(results.keys()) };
}

export function loadInboxMarks(storage: Storage = window.localStorage): InboxMark[] {
  return readList(storage, KEY, markSchema, MAX_MARKS);
}

/** Zero means read, a timestamp means snoozed until then, and null clears the mark. */
export function saveInboxMark(key: string, until: number | null, retained: ReadonlySet<string>, storage: Storage = window.localStorage): InboxMark[] {
  const marks = loadInboxMarks(storage).filter((mark) => mark.key !== key && retained.has(mark.key));
  if (until !== null && retained.has(key)) marks.unshift(markSchema.parse({ key, until }));
  storage.setItem(KEY, JSON.stringify(marks.slice(0, MAX_MARKS)));
  return marks;
}
