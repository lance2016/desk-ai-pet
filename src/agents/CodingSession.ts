import { z } from "zod";

/**
 * Where a session's current turn stands. A turn is one request and Claude's
 * work on it; the session goes on after it. "completed" says only that the
 * turn ended, not that the user's task is done. "background": it ended with
 * work it started (a shell, a subagent) still running, and Claude goes on with
 * the same turn once that is done.
 */
export const TURN_STATES = ["working", "waiting", "completed", "background", "failed", "interrupted", "idle", "unknown"] as const;
export type TurnState = (typeof TURN_STATES)[number];

/** `earlier`: the turns kept before the current one, so the panel shows the last five. */
export const SESSION_LIMITS = { id: 56, name: 160, line: 320, kept: 32, earlier: 4 } as const;

const line = z.string().max(SESSION_LIMITS.line).optional();

/** A turn before the current one: what was asked and how it came out. */
export const pastTurnSchema = z.object({
  task: z.string().max(SESSION_LIMITS.name).optional(),
  /** Where it stood when the next turn began: a live state means the user asked again before it ended. */
  turn: z.enum(TURN_STATES),
  result: line,
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});

export type PastTurn = z.infer<typeof pastTurnSchema>;

/**
 * One coding session as the pet shows it, made from the agent's hook events by
 * `ClaudeSessions`. The card and the panel read only this, never a hook payload.
 * Saved on this Mac, so it is checked when read back.
 */
export const codingSessionSchema = z.object({
  /** The agent's own session id: two sessions in one folder stay apart by it. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(SESSION_LIMITS.id),
  provider: z.literal("claude-code"),
  /** The last part of the session's folder. */
  project: z.string().max(SESSION_LIMITS.name),
  branch: z.string().max(SESSION_LIMITS.name).optional(),
  /** The session's name: the one the user gave it, else the agent's own. */
  name: z.string().max(SESSION_LIMITS.name).optional(),
  /** The first line of what the user asked this turn. */
  task: z.string().max(SESSION_LIMITS.name).optional(),
  /** What it is on while it works, such as "修改 App.tsx". */
  activity: line,
  turn: z.enum(TURN_STATES),
  /** The session itself is over (the agent said so). */
  ended: z.boolean(),
  /** What it waits for, in words. */
  asking: line,
  /** The tool it asked to use; that tool finishing means the user answered. */
  waitingFor: z.string().max(SESSION_LIMITS.name).optional(),
  /** How the last turn came out: the start of the agent's reply, or what went wrong. */
  result: line,
  /** The pet can bring the app the session runs in to the front. */
  revealable: z.boolean(),
  turnStartedAt: z.number().optional(),
  turnEndedAt: z.number().optional(),
  /** When background work it was left to woke the turn up again; anything from before that is old news. */
  turnResumedAt: z.number().optional(),
  lastEventAt: z.number(),
  /** The turns before this one, the oldest first. Only those the pet heard, each asked in one line. */
  earlier: z.array(pastTurnSchema).max(SESSION_LIMITS.earlier).optional(),
});

export type CodingSession = z.infer<typeof codingSessionSchema>;

/** A result is the card's business for this long; after that it is only a recent session in the panel. */
export const RESULT_FRESH_MS = 5 * 60_000;

const NAME_FALLBACK = "Claude Code 会话";

export const isLive = (session: CodingSession) => session.turn === "working" || session.turn === "waiting";

/** What the session is about: its name, else what was asked this turn, else what was asked last. */
export const sessionTitle = (session: CodingSession) => session.name ?? session.task ?? lastAsked(session.earlier ?? []) ?? NAME_FALLBACK;

const lastAsked = (turns: readonly PastTurn[]) => [...turns].reverse().find((turn) => turn.task !== undefined)?.task;

/** The session's state in a word or two. */
export function stateWord(session: CodingSession): string {
  switch (session.turn) {
    case "working": return "在工作";
    case "waiting": return "等你处理";
    case "completed": return "这一轮做完了";
    case "background": return "后台还在跑";
    case "failed": return "出错了";
    case "interrupted": return "已打断";
    case "unknown": return "状态未知";
    case "idle": return session.ended ? "会话已结束" : "空闲";
  }
}

/** One line under the title: what it is on, what it waits for, or how the turn came out. Null when there is nothing to add. */
export function stateLine(session: CodingSession): string | null {
  switch (session.turn) {
    case "working": return session.activity ?? null;
    case "waiting": return session.asking ?? "在等你确认";
    case "completed":
    case "failed": return session.result ?? null;
    case "background": return session.result ?? "这一轮停了，跑完 Claude 会接着做";
    case "unknown": return "很久没有动静，可能还在跑，也可能已经退出";
    case "interrupted":
    case "idle": return null;
  }
}

const fresh = (session: CodingSession, now: number) => session.turnEndedAt !== undefined && now - session.turnEndedAt < RESULT_FRESH_MS;

const latestFirst = (a: CodingSession, b: CodingSession) => b.lastEventAt - a.lastEventAt;

export interface CodingOverview {
  /** Waiting for the user, the one waiting longest first. */
  waiting: CodingSession[];
  working: CodingSession[];
  /**
   * The one session the card is about: one waiting for the user, else a fresh
   * failure, else one at work, else a turn that just ended or was left to
   * background work. Null when nothing is going on; an old result is not brought up again.
   */
  headline: CodingSession | null;
}

/** The sessions sorted by how much they need the user. */
export function overview(sessions: readonly CodingSession[], now: number): CodingOverview {
  const waiting = sessions.filter((session) => session.turn === "waiting").sort((a, b) => a.lastEventAt - b.lastEventAt);
  const working = sessions.filter((session) => session.turn === "working").sort(latestFirst);
  const settled = sessions.filter((session) => !isLive(session)).sort(latestFirst);
  const news = settled.filter((session) => fresh(session, now));
  const headline = waiting[0]
    ?? news.find((session) => session.turn === "failed")
    ?? working[0]
    ?? news.find((session) => session.turn === "completed" || session.turn === "background")
    ?? null;
  return { waiting, working, headline };
}

/** How much a session needs the user: waiting, then working, then the rest. */
const need = (session: CodingSession) => (session.turn === "waiting" ? 0 : session.turn === "working" ? 1 : 2);

/** Waiting ones first, the one waiting longest first; then working; then the rest; within those, the latest first. */
const byNeed = (a: CodingSession, b: CodingSession) =>
  need(a) - need(b) || (a.turn === "waiting" ? a.lastEventAt - b.lastEventAt : latestFirst(a, b));

export interface ProjectGroup {
  /** The session's folder name: two folders with one name share a group. */
  project: string;
  /** Sessions still open, the ones needing the user first. A click goes back to the terminal when that is known. */
  open: CodingSession[];
  /** Sessions that ended: only their resume command is left. The latest first. */
  closed: CodingSession[];
  /** Its sessions are on more than one branch, so each says which. */
  branched: boolean;
}

/**
 * The sessions by folder. A folder with a session waiting for the user comes
 * first, then one with a session at work, then one with an open session, then
 * the rest; within each, the one heard from last first.
 * Ended sessions are kept apart: they cannot be gone back to, only resumed.
 */
export function byProject(sessions: readonly CodingSession[]): ProjectGroup[] {
  const folders = new Map<string, CodingSession[]>();
  for (const session of sessions) folders.set(session.project, [...(folders.get(session.project) ?? []), session]);
  const groups = [...folders].map(([project, list]) => ({
    project,
    open: list.filter((session) => !session.ended).sort(byNeed),
    closed: list.filter((session) => session.ended).sort(latestFirst),
    branched: new Set(list.flatMap((session) => (session.branch ? [session.branch] : []))).size > 1,
    // A folder with nothing but ended sessions goes after every folder with an open one.
    rank: Math.min(...list.map((session) => (session.ended ? 3 : need(session)))),
    last: Math.max(...list.map((session) => session.lastEventAt)),
  }));
  return groups
    .sort((a, b) => a.rank - b.rank || b.last - a.last)
    .map(({ rank: _rank, last: _last, ...group }) => group);
}

/** The folder the user pinned goes first, the rest stay as they were. */
export function pinnedFirst(groups: readonly ProjectGroup[], pinned: string | null): ProjectGroup[] {
  const at = groups.findIndex((group) => group.project === pinned);
  return at <= 0 ? [...groups] : [groups[at], ...groups.slice(0, at), ...groups.slice(at + 1)];
}

/** The command that opens the session again in a terminal. */
export const resumeCommand = (session: CodingSession) => `claude --resume ${session.id}`;
