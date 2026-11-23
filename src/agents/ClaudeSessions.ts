import { ACTIVITY_LIMITS } from "../activity/Activity";
import type { TurnOver } from "../platform/agents";
import type { ActivityUpdate, AgentReport } from "../types";
import { SESSION_LIMITS, isLive, type CodingSession, type PastTurn } from "./CodingSession";

export const CLAUDE_CONFIG = {
  /** A turn shorter than this ends quietly: the user most likely watched it. */
  shortTurnMs: 30_000,
  /** One tool can run this long without a hook event (a long build); after that the pet no longer says it works. */
  staleRunningMs: 30 * 60_000,
  /** A question can wait while the user is away; a session killed with its terminal sends nothing, so it is let go in the end. */
  staleWaitingMs: 3 * 60 * 60_000,
  /** Sessions no longer working or waiting stay listed this long, and at most this many in each folder, so one busy folder does not push out another's. */
  recentMs: 24 * 60 * 60_000,
  recentKept: 5,
};

/** Each session's activity id is this followed by its session id. */
export const CLAUDE_ACTIVITY_PREFIX = "claude:";
/** The button on the pet's line about a session the pet can take the user back to. */
const BACK_TO_TERMINAL = "回到终端";

/** How much of a folder or tool name a line takes. */
const NAME_CHARS = 24;
const LABEL_FALLBACK = "Claude";
/** How far a turn's prompt can trail its first tool and still be taken as that turn's. Hooks run in the background. */
const LATE_PROMPT_MS = 10_000;

/** What a failed turn's `error` means to the user. Anything else is "出错了". */
const FAILURES: Record<string, string> = {
  rate_limit: "额度用完了",
  authentication_failed: "登录失效了，去终端重新登录",
  billing_error: "账户付费出了问题",
  server_error: "Claude 的服务出错了",
  max_output_tokens: "回复太长，被截断了",
};
const FAILURE_FALLBACK = "出错了";

/** Notifications that mean Claude is stuck until the user answers. */
const ASKING = new Set(["permission_prompt", "elicitation_dialog"]);

const CHANGING = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SEARCHING = new Set(["Grep", "Glob"]);
const LOOKING_UP = new Set(["WebFetch", "WebSearch"]);
const DELEGATING = new Set(["Agent", "Task"]);
/** Bookkeeping tools: what it was on before still says more. */
const UNREMARKABLE = new Set(["TodoWrite", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "ToolSearch"]);

/** `text` cut to `max` UTF-16 units, as the schema counts, without splitting a character; the last one an ellipsis when cut. */
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  let kept = "";
  for (const char of text) {
    if (kept.length + char.length > max - 1) break;
    kept += char;
  }
  return `${kept}…`;
}

/** "mcp__server__tool" reads as "tool". */
const toolName = (tool: string) => fit(tool.startsWith("mcp__") ? tool.slice(tool.lastIndexOf("__") + 2) || tool : tool, NAME_CHARS);

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.floor(ms / 1000)} 秒`;
  if (minutes < 60) return `${minutes} 分钟`;
  return minutes % 60 === 0 ? `${minutes / 60} 小时` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

/** What a tool about to run is doing, in a few words; undefined when it says nothing new. `detail` is its file or its described step. */
function describeTool(tool: string, detail: string | undefined): string | undefined {
  if (UNREMARKABLE.has(tool)) return undefined;
  if (CHANGING.has(tool)) return detail ? `修改 ${detail}` : "修改文件";
  if (tool === "Read") return detail ? `阅读 ${detail}` : "阅读文件";
  if (tool === "Bash") return detail ?? "运行命令";
  if (SEARCHING.has(tool)) return "搜索代码";
  if (LOOKING_UP.has(tool)) return "查资料";
  if (DELEGATING.has(tool)) return detail ? `子任务：${detail}` : "分派子任务";
  return `使用 ${toolName(tool)}`;
}

/** What it wants from the user. `detail` is the tool's file or described step. */
function describeAsk(tool: string | undefined, detail: string | undefined): string {
  if (tool === "AskUserQuestion") return "有话问你";
  if (tool === "ExitPlanMode") return "写好计划了，等你过目";
  if (tool && CHANGING.has(tool) && detail) return `想改 ${detail}，等你点头`;
  if (tool === "Read" && detail) return `想读 ${detail}，等你点头`;
  if (tool && detail) return `想用 ${toolName(tool)}（${detail}），等你点头`;
  if (tool) return `想用 ${toolName(tool)}，等你点头`;
  return "在等你确认";
}

/**
 * The Claude Code sessions the pet is following. Turns the hook events the
 * native side forwards into `CodingSession`s, which the coding card and panel
 * show, and into one `ActivityUpdate` per change of state, to which the pet
 * reacts. A session outlives its turns: once a turn ends it stays listed as a
 * recent session until it is old or pushed out.
 *
 * Hooks run in the background, so an event can arrive late or twice; each is
 * placed by the time its hook ran. Claude Code sends nothing when the user
 * presses Esc or the terminal is closed, so `checks()` lists the sessions whose
 * transcript should be looked at, and `expire()` stops saying a session works
 * when nothing has been heard for too long, without claiming it finished.
 */
export class ClaudeSessions {
  private sessions = new Map<string, CodingSession>();
  /** Sessions the user named: Claude Code's own title does not replace that. */
  private named = new Set<string>();

  /** `restored`: the sessions as they were when the pet last ran. */
  constructor(restored: readonly CodingSession[] = []) {
    for (const session of restored) this.sessions.set(session.id, session);
  }

  /** The sessions as they stand, the latest first. */
  list(): CodingSession[] {
    return [...this.sessions.values()].sort((a, b) => b.lastEventAt - a.lastEventAt);
  }

  /** Takes a hook event. Returns what the pet should react to, or null when its state did not change. */
  report(report: AgentReport, now: number): ActivityUpdate | null {
    // 0 comes from a hook that could not tell the time.
    const at = report.at || now;
    const before = this.sessions.get(report.session);
    // The prompt that started this turn, overtaken by the turn's first tool: it only names the turn.
    if (before && report.event === "UserPromptSubmit" && before.turn === "working" && before.turnStartedAt !== undefined
      && at < before.turnStartedAt && before.turnStartedAt - at <= LATE_PROMPT_MS) {
      this.sessions.set(before.id, { ...before, turnStartedAt: at, ...(report.task ? { task: fit(report.task, SESSION_LIMITS.name) } : {}) });
      return null;
    }
    // It ran before this turn began or after it ended: a straggler that says nothing new.
    if (before && at < Math.max(before.turnStartedAt ?? 0, before.turnEndedAt ?? 0)) return null;
    // It ran before the session ended: only something after the end brings a session back.
    if (before?.ended && at <= before.lastEventAt) return null;
    if (report.title) this.named.add(report.session);
    const known = before && this.refreshed(before, report, at);
    switch (report.event) {
      case "SessionStart":
        // Also sent mid-turn after a compaction: a session already known keeps its turn.
        this.sessions.set(report.session, known ?? this.fresh(report, at, "idle"));
        return null;
      case "UserPromptSubmit":
        return this.work(report, known, at, true);
      case "PreToolUse": {
        if (report.subagent || known?.turn === "waiting") return this.touch(known);
        const activity = report.tool ? describeTool(report.tool, report.detail) : undefined;
        const update = this.work(report, known, at, false);
        const session = this.sessions.get(report.session);
        if (session && activity) this.sessions.set(report.session, { ...session, activity: fit(activity, SESSION_LIMITS.line) });
        return update;
      }
      case "PostToolUse":
        // A subagent's tool or one running alongside says nothing about the question still open.
        if (report.subagent || known?.turn === "working" || (known?.turn === "waiting" && known.waitingFor !== undefined && known.waitingFor !== report.tool)) return this.touch(known);
        return this.work(report, known, at, false);
      case "PermissionRequest":
        return this.ask(report, known, at, report.tool);
      case "Notification":
        if (!ASKING.has(report.notification ?? "") || known?.turn === "waiting") return this.touch(known);
        return this.ask(report, known, at, undefined);
      case "Stop":
        // A second Stop for a turn already over changes nothing.
        if (known && !isLive(known)) return this.touch(known);
        return this.finish(known ?? this.fresh(report, at, "idle"), at, report.summary);
      case "StopFailure": {
        const reason = FAILURES[report.error ?? ""] ?? FAILURE_FALLBACK;
        const session = this.over(known ?? this.fresh(report, at, "idle"), "failed", at, reason);
        return this.withWayBack(session, this.update(session, "failed", `${this.side(session.project)} 那边停下了：${reason}`));
      }
      case "SessionEnd": {
        if (!known) return null;
        const wasLive = isLive(known);
        this.sessions.set(known.id, { ...this.settled(known), turn: wasLive ? "idle" : known.turn, ended: true, revealable: false });
        return wasLive ? this.update(known, "cancelled") : null;
      }
    }
  }

  /**
   * The transcript shows the turn was over after `since`: interrupted with Esc, or
   * ended with a Stop the pet never got. Ignored when an event came in meanwhile.
   */
  turnOver(session: string, since: number, how: NonNullable<TurnOver>, now: number): ActivityUpdate | null {
    const known = this.sessions.get(session);
    if (!known || !isLive(known) || known.lastEventAt !== since) return null;
    if (how === "ended") return this.finish(known, now, undefined);
    return this.update(this.over(known, "interrupted", now, undefined), "cancelled");
  }

  /** Claude Code's own name for the session. A name the user gave it stays. Returns whether anything changed. */
  rename(session: string, name: string): boolean {
    const known = this.sessions.get(session);
    const next = fit(name.trim(), SESSION_LIMITS.name);
    if (!known || !next || this.named.has(session) || known.name === next) return false;
    this.sessions.set(session, { ...known, name: next });
    return true;
  }

  /** Sessions working or waiting, with the time of their last event: their transcripts may show the turn is over. */
  checks(): { session: string; since: number }[] {
    return this.list().filter(isLive).map((session) => ({ session: session.id, since: session.lastEventAt }));
  }

  /** What the pet should be showing for a session still working or waiting, as after a restart. */
  activity(session: string): ActivityUpdate | null {
    const known = this.sessions.get(session);
    if (!known || !isLive(known)) return null;
    return known.turn === "waiting" ? this.withWayBack(known, this.update(known, "waiting", this.askLine(known))) : this.update(known, "running");
  }

  /**
   * Stops saying a session works or waits when nothing was heard for too long: its
   * state is then unknown, not finished. Drops recent sessions that are old or too many.
   */
  expire(now: number): ActivityUpdate[] {
    const updates = this.list().filter(isLive).flatMap((known) => {
      const limit = known.turn === "waiting" ? CLAUDE_CONFIG.staleWaitingMs : CLAUDE_CONFIG.staleRunningMs;
      if (now - known.lastEventAt <= limit) return [];
      this.sessions.set(known.id, { ...this.settled(known), turn: "unknown" });
      return [this.update(known, "cancelled")];
    });
    const counted = new Map<string, number>();
    for (const session of this.list().filter((known) => !isLive(known))) {
      const index = counted.get(session.project) ?? 0;
      counted.set(session.project, index + 1);
      if (index < CLAUDE_CONFIG.recentKept && now - session.lastEventAt <= CLAUDE_CONFIG.recentMs) continue;
      this.sessions.delete(session.id);
      this.named.delete(session.id);
    }
    return updates;
  }

  /** A session first heard of with this event. */
  private fresh(report: AgentReport, at: number, turn: CodingSession["turn"]): CodingSession {
    return this.refreshed({ id: report.session, provider: "claude-code", project: report.project, turn, ended: false, revealable: false, lastEventAt: at }, report, at);
  }

  /** `known` with what any event says about its session: it is alive, where it runs, its branch and name. */
  private refreshed(known: CodingSession, report: AgentReport, at: number): CodingSession {
    return {
      ...known,
      project: report.project || known.project,
      ended: false,
      revealable: report.revealable ?? known.revealable,
      lastEventAt: Math.max(known.lastEventAt, at),
      ...(report.branch ? { branch: fit(report.branch, SESSION_LIMITS.name) } : {}),
      ...(report.title ? { name: fit(report.title, SESSION_LIMITS.name) } : {}),
    };
  }

  /** Something happened that changes nothing the pet reacts to; the session is not quiet. */
  private touch(known: CodingSession | undefined): null {
    if (known) this.sessions.set(known.id, known);
    return null;
  }

  /** `known` without what belonged to the turn in progress. */
  private settled(known: CodingSession): CodingSession {
    const { activity: _activity, asking: _asking, waitingFor: _waitingFor, ...rest } = known;
    return rest;
  }

  /** `known` with its last turn put away among the earlier ones and nothing of it left, so a new turn can start. */
  private putAway(known: CodingSession): CodingSession {
    const { task, result, turnStartedAt, turnEndedAt, earlier = [], ...rest } = this.settled(known);
    if (task === undefined && turnStartedAt === undefined) return rest;
    const past: PastTurn = {
      turn: known.turn,
      ...(task !== undefined ? { task } : {}),
      ...(result !== undefined ? { result } : {}),
      ...(turnStartedAt !== undefined ? { startedAt: turnStartedAt } : {}),
      ...(turnEndedAt !== undefined ? { endedAt: turnEndedAt } : {}),
    };
    return { ...rest, earlier: [...earlier, past].slice(-SESSION_LIMITS.earlier) };
  }

  /** It is at work. `prompted`: the user just asked, so a new turn starts; otherwise one starts only if none was going. */
  private work(report: AgentReport, known: CodingSession | undefined, at: number, prompted: boolean): ActivityUpdate | null {
    const base = known ?? this.fresh(report, at, "idle");
    // The same prompt twice (hooks can be delivered twice) is still the one turn.
    const starting = (prompted && base.turnStartedAt !== at) || !isLive(base);
    const wasWorking = base.turn === "working";
    const session: CodingSession = starting
      ? { ...this.putAway(base), turn: "working", turnStartedAt: at, ...(report.task ? { task: fit(report.task, SESSION_LIMITS.name) } : {}) }
      : { ...this.settled(base), turn: "working", ...(base.activity ? { activity: base.activity } : {}) };
    this.sessions.set(session.id, session);
    return wasWorking && !prompted ? null : this.update(session, "running");
  }

  private ask(report: AgentReport, known: CodingSession | undefined, at: number, tool: string | undefined): ActivityUpdate {
    const base = known ?? this.fresh(report, at, "idle");
    // Asked out of the blue (the pet missed the start): a new turn is counted from here.
    const current = isLive(base) ? base : { ...this.putAway(base), turnStartedAt: at };
    const { waitingFor: _waitingFor, ...carried } = current;
    const session: CodingSession = {
      ...carried,
      turn: "waiting",
      asking: fit(describeAsk(tool, report.detail), SESSION_LIMITS.line),
      ...(tool ? { waitingFor: tool } : {}),
    };
    this.sessions.set(session.id, session);
    return this.withWayBack(session, this.update(session, "waiting", this.askLine(session)));
  }

  /** The turn ended: a long one is told about, a short one goes quietly. */
  private finish(known: CodingSession, at: number, summary: string | undefined): ActivityUpdate {
    const took = known.turnStartedAt === undefined ? 0 : at - known.turnStartedAt;
    const session = this.over(known, "completed", at, summary);
    if (took < CLAUDE_CONFIG.shortTurnMs) return this.update(session, "cancelled");
    return this.update(session, "done", `${this.side(session.project)} 那边这一轮做完了，用了 ${duration(took)}`);
  }

  /** Records how the turn ended. */
  private over(known: CodingSession, turn: "completed" | "failed" | "interrupted", at: number, result: string | undefined): CodingSession {
    const { result: _result, ...rest } = this.settled(known);
    const session: CodingSession = { ...rest, turn, turnEndedAt: at, lastEventAt: Math.max(known.lastEventAt, at), ...(result ? { result: fit(result, SESSION_LIMITS.line) } : {}) };
    this.sessions.set(session.id, session);
    return session;
  }

  private askLine(session: CodingSession): string {
    const who = session.project ? `${this.side(session.project)} 里的 Claude` : LABEL_FALLBACK;
    return `${who} ${session.asking ?? "在等你确认"}`;
  }

  /** Which session a line is about: its folder, or "Claude" without one. */
  private side(project: string): string {
    return project ? fit(project, NAME_CHARS) : LABEL_FALLBACK;
  }

  /** A line about something the user has to see in the terminal gets a button back to it, when the pet knows where that is. */
  private withWayBack(session: CodingSession, update: ActivityUpdate): ActivityUpdate {
    return session.revealable ? { ...update, opens: BACK_TO_TERMINAL } : update;
  }

  private update(session: CodingSession, state: ActivityUpdate["state"], text?: string): ActivityUpdate {
    const update: ActivityUpdate = { id: `${CLAUDE_ACTIVITY_PREFIX}${session.id}`, state, label: fit(session.project || LABEL_FALLBACK, ACTIVITY_LIMITS.label), icon: "agent", noChip: true };
    return text ? { ...update, text: fit(text, ACTIVITY_LIMITS.text) } : update;
  }
}
