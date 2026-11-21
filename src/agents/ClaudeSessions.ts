import { ACTIVITY_LIMITS } from "../activity/Activity";
import type { ActivityUpdate, AgentReport } from "../types";

export const CLAUDE_CONFIG = {
  /** A turn shorter than this ends quietly: the user most likely watched it. */
  shortTurnMs: 30_000,
  /** One tool can run this long without a hook event (a long build); after that the chip goes. */
  staleRunningMs: 30 * 60_000,
  /** A question can wait while the user is away; a session killed with its terminal sends nothing, so it goes in the end. */
  staleWaitingMs: 3 * 60 * 60_000,
};

/** How much of a folder or tool name the standing line takes. */
const NAME_CHARS = 24;
const LABEL_FALLBACK = "Claude";

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

interface Session {
  project: string;
  turnStartedAt: number;
  lastEventAt: number;
  waiting: boolean;
  /** The tool it asked to use; its PostToolUse means the user answered. Unknown after a bare notification. */
  waitingFor?: string;
}

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

/**
 * The Claude Code sessions the pet is following, one activity each. Turns the
 * hook events the native side forwards into `ActivityUpdate`s; the engine
 * decides how the pet shows them. Only in memory: after a restart a session
 * comes back with its next event.
 *
 * Claude Code sends nothing when the user presses Esc, so `checks()` lists the
 * sessions whose transcript should be looked at, and `expire()` lets go of
 * sessions quiet for too long.
 */
export class ClaudeSessions {
  private sessions = new Map<string, Session>();

  /** Takes a hook event. Returns what to report, or null when the pet shows nothing new. */
  report(report: AgentReport, now: number): ActivityUpdate | null {
    const known = this.sessions.get(report.session);
    switch (report.event) {
      case "UserPromptSubmit":
        return this.start(report, { project: report.project, turnStartedAt: now, lastEventAt: now, waiting: false });
      case "PermissionRequest":
        return this.ask(report, known, now, report.tool);
      case "Notification":
        if (!ASKING.has(report.notification ?? "") || known?.waiting) return this.touch(report.session, known, now);
        return this.ask(report, known, now, undefined);
      case "PostToolUse":
        // A subagent's tool or one running alongside says nothing about the question still open.
        if (report.subagent || (known && (!known.waiting || (known.waitingFor !== undefined && known.waitingFor !== report.tool)))) return this.touch(report.session, known, now);
        return this.start(report, { project: report.project, turnStartedAt: known?.turnStartedAt ?? now, lastEventAt: now, waiting: false });
      case "Stop":
        if (!known) return null;
        this.sessions.delete(report.session);
        if (now - known.turnStartedAt < CLAUDE_CONFIG.shortTurnMs) return this.update(report.session, known.project, "cancelled");
        return this.update(report.session, known.project, "done", `${this.side(known.project)} 那边做完了，用了 ${duration(now - known.turnStartedAt)}`);
      case "StopFailure":
        this.sessions.delete(report.session);
        return this.update(report.session, report.project, "failed", `${this.side(report.project)} 那边停下了：${FAILURES[report.error ?? ""] ?? FAILURE_FALLBACK}`);
      case "SessionEnd":
        if (!known) return null;
        this.sessions.delete(report.session);
        return this.update(report.session, known.project, "cancelled");
    }
  }

  /** The transcript shows the user interrupted the turn after `since`. Ignored when an event came in meanwhile. */
  interrupted(session: string, since: number): ActivityUpdate | null {
    const known = this.sessions.get(session);
    if (!known || known.lastEventAt !== since) return null;
    this.sessions.delete(session);
    return this.update(session, known.project, "cancelled");
  }

  /** Sessions working or waiting, with the time of their last event: their transcripts may show an interruption. */
  checks(): { session: string; since: number }[] {
    return [...this.sessions].map(([session, known]) => ({ session, since: known.lastEventAt }));
  }

  /** Lets go of sessions quiet for too long. */
  expire(now: number): ActivityUpdate[] {
    return [...this.sessions].flatMap(([session, known]) => {
      const limit = known.waiting ? CLAUDE_CONFIG.staleWaitingMs : CLAUDE_CONFIG.staleRunningMs;
      if (now - known.lastEventAt <= limit) return [];
      this.sessions.delete(session);
      return [this.update(session, known.project, "cancelled")];
    });
  }

  private start(report: AgentReport, session: Session): ActivityUpdate {
    this.sessions.set(report.session, session);
    return this.update(report.session, session.project, "running");
  }

  private ask(report: AgentReport, known: Session | undefined, now: number, tool: string | undefined): ActivityUpdate {
    this.sessions.set(report.session, { project: report.project, turnStartedAt: known?.turnStartedAt ?? now, lastEventAt: now, waiting: true, ...(tool ? { waitingFor: tool } : {}) });
    const who = report.project ? `${this.side(report.project)} 里的 Claude` : LABEL_FALLBACK;
    const text = tool === "AskUserQuestion" ? `${who} 有话问你`
      : tool === "ExitPlanMode" ? `${who} 写好计划了，等你过目`
      : tool ? `${who} 想用 ${toolName(tool)}，等你点头`
      : `${who} 在等你确认`;
    return this.update(report.session, report.project, "waiting", text);
  }

  /** Something happened that changes nothing on the pet; the session is not quiet. */
  private touch(id: string, known: Session | undefined, now: number): null {
    if (known) this.sessions.set(id, { ...known, lastEventAt: now });
    return null;
  }

  /** Which session the line is about: its folder, or "Claude" without one. */
  private side(project: string): string {
    return project ? fit(project, NAME_CHARS) : LABEL_FALLBACK;
  }

  private update(session: string, project: string, state: ActivityUpdate["state"], text?: string): ActivityUpdate {
    const update: ActivityUpdate = { id: `claude:${session}`, state, label: fit(project || LABEL_FALLBACK, ACTIVITY_LIMITS.label), icon: "agent" };
    return text ? { ...update, text } : update;
  }
}
