import { z } from "zod";

/**
 * Where a session's current turn stands. A turn is one request and Claude's
 * work on it; the session goes on after it. "completed" says only that the
 * turn ended, not that the user's task is done.
 */
export const TURN_STATES = ["working", "waiting", "completed", "failed", "interrupted", "idle", "unknown"] as const;
export type TurnState = (typeof TURN_STATES)[number];

export const SESSION_LIMITS = { id: 56, name: 160, line: 320, kept: 32 } as const;

const line = z.string().max(SESSION_LIMITS.line).optional();

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
  lastEventAt: z.number(),
});

export type CodingSession = z.infer<typeof codingSessionSchema>;

/** A result is the card's business for this long; after that it is only a recent session in the panel. */
export const RESULT_FRESH_MS = 5 * 60_000;

const NAME_FALLBACK = "Claude Code 会话";

export const isLive = (session: CodingSession) => session.turn === "working" || session.turn === "waiting";

/** What the session is about: its name, else what was asked this turn. */
export const sessionTitle = (session: CodingSession) => session.name ?? session.task ?? NAME_FALLBACK;

/** The session's state in a word or two. */
export function stateWord(session: CodingSession): string {
  switch (session.turn) {
    case "working": return "在工作";
    case "waiting": return "等你处理";
    case "completed": return "这一轮做完了";
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
  /** Done for now with their terminal still known, so a click goes back to it; the latest first. */
  recent: CodingSession[];
  /** Done for now with no terminal to go back to (the session ended): only its resume command is left. The latest first. */
  closed: CodingSession[];
  /**
   * The one session the card is about: one waiting for the user, else a fresh
   * failure, else one at work, else a turn that just ended. Null when nothing
   * is going on; an old result is not brought up again.
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
    ?? news.find((session) => session.turn === "completed")
    ?? null;
  return {
    waiting,
    working,
    recent: settled.filter((session) => session.revealable),
    closed: settled.filter((session) => !session.revealable),
    headline,
  };
}

/** The command that opens the session again in a terminal. */
export const resumeCommand = (session: CodingSession) => `claude --resume ${session.id}`;
