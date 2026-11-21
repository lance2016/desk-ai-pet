import { describe, expect, it } from "vitest";
import { activityUpdateSchema } from "../activity/Activity";
import type { AgentReport } from "../types";
import { CLAUDE_CONFIG, ClaudeSessions } from "./ClaudeSessions";

const SESSION = "51595e2a-65fa-42e0-96d7-8ba91d2c7fa1";
const ID = `claude:${SESSION}`;
const report = (event: AgentReport["event"], extra: Partial<AgentReport> = {}): AgentReport => ({ event, session: SESSION, project: "ai-pet", ...extra });

/** A session that has been working since `at`. */
function working(at = 0) {
  const sessions = new ClaudeSessions();
  sessions.report(report("UserPromptSubmit"), at);
  return sessions;
}

describe("ClaudeSessions", () => {
  it("shows a spinning chip named after the project once a prompt is sent", () => {
    const sessions = new ClaudeSessions();
    expect(sessions.report(report("UserPromptSubmit"), 0)).toEqual({ id: ID, state: "running", label: "ai-pet", icon: "agent" });
  });

  it("asks the user, naming the tool, when Claude wants permission", () => {
    expect(working().report(report("PermissionRequest", { tool: "Bash" }), 1000)).toMatchObject({ id: ID, state: "waiting", text: "ai-pet 里的 Claude 想用 Bash，等你点头" });
  });

  it("says a question or a plan in plain words, and shortens an MCP tool to its own name", () => {
    expect(working().report(report("PermissionRequest", { tool: "AskUserQuestion" }), 1)?.text).toBe("ai-pet 里的 Claude 有话问你");
    expect(working().report(report("PermissionRequest", { tool: "ExitPlanMode" }), 1)?.text).toBe("ai-pet 里的 Claude 写好计划了，等你过目");
    expect(working().report(report("PermissionRequest", { tool: "mcp__claude-in-chrome__navigate" }), 1)?.text).toBe("ai-pet 里的 Claude 想用 navigate，等你点头");
  });

  it("goes back to spinning once a tool has run, and says nothing more while it keeps running", () => {
    const sessions = working();
    sessions.report(report("PermissionRequest", { tool: "Bash" }), 1);
    expect(sessions.report(report("PostToolUse", { tool: "Bash" }), 2)).toMatchObject({ state: "running" });
    expect(sessions.report(report("PostToolUse", { tool: "Read" }), 3)).toBeNull();
  });

  it("keeps waiting while another tool running alongside finishes", () => {
    const sessions = working();
    sessions.report(report("PermissionRequest", { tool: "Bash" }), 1);
    expect(sessions.report(report("PostToolUse", { tool: "Read" }), 2)).toBeNull();
    expect(sessions.report(report("PostToolUse", { tool: "Bash" }), 3)).toMatchObject({ state: "running" });
  });

  it("lets a subagent's tools keep a session alive but never start or change one", () => {
    const sessions = working(0);
    sessions.report(report("PermissionRequest", { tool: "Bash" }), 1);
    expect(sessions.report(report("PostToolUse", { tool: "Bash", subagent: true }), 2)).toBeNull();
    expect(sessions.checks()).toEqual([{ session: SESSION, since: 2 }]);
    expect(new ClaudeSessions().report(report("PostToolUse", { tool: "Read", subagent: true }), 0)).toBeNull();
  });

  it("falls back to a permission notification only when no request came first", () => {
    const sessions = working();
    expect(sessions.report(report("Notification", { notification: "permission_prompt" }), 1)).toMatchObject({ state: "waiting", text: "ai-pet 里的 Claude 在等你确认" });
    const asked = working();
    asked.report(report("PermissionRequest", { tool: "Bash" }), 1);
    expect(asked.report(report("Notification", { notification: "permission_prompt" }), 6000)).toBeNull();
    expect(working().report(report("Notification", { notification: "idle_prompt" }), 1)).toBeNull();
  });

  it("tells a long turn's end with how long it took, and lets a short one go quietly", () => {
    expect(working(0).report(report("Stop"), 12 * 60_000 + 5000)).toEqual({ id: ID, state: "done", label: "ai-pet", icon: "agent", text: "ai-pet 那边做完了，用了 12 分钟" });
    expect(working(0).report(report("Stop"), 45_000)?.text).toBe("ai-pet 那边做完了，用了 45 秒");
    expect(working(0).report(report("Stop"), 65 * 60_000)?.text).toBe("ai-pet 那边做完了，用了 1 小时 5 分钟");
    expect(working(0).report(report("Stop"), CLAUDE_CONFIG.shortTurnMs - 1)).toEqual({ id: ID, state: "cancelled", label: "ai-pet", icon: "agent" });
  });

  it("forgets a session once its turn is over", () => {
    const sessions = working();
    sessions.report(report("Stop"), 1000);
    expect(sessions.checks()).toEqual([]);
    expect(sessions.report(report("Stop"), 2000)).toBeNull();
  });

  it("says why a turn failed in the user's words", () => {
    expect(working().report(report("StopFailure", { error: "rate_limit" }), 1)).toMatchObject({ state: "failed", text: "ai-pet 那边停下了：额度用完了" });
    expect(working().report(report("StopFailure", { error: "authentication_failed" }), 1)?.text).toBe("ai-pet 那边停下了：登录失效了，去终端重新登录");
    expect(working().report(report("StopFailure", { error: "something_new" }), 1)?.text).toBe("ai-pet 那边停下了：出错了");
  });

  it("takes a session that was already running when the pet started", () => {
    const sessions = new ClaudeSessions();
    expect(sessions.report(report("PostToolUse", { tool: "Read" }), 0)).toMatchObject({ state: "running" });
    expect(new ClaudeSessions().report(report("Stop"), 0)).toBeNull();
    expect(new ClaudeSessions().report(report("SessionEnd"), 0)).toBeNull();
  });

  it("drops the chip when the session ends", () => {
    expect(working().report(report("SessionEnd"), 1)).toMatchObject({ state: "cancelled" });
  });

  it("calls a turn off when the transcript says the user interrupted it, unless something happened since", () => {
    const sessions = working(0);
    expect(sessions.checks()).toEqual([{ session: SESSION, since: 0 }]);
    expect(sessions.interrupted(SESSION, 0)).toMatchObject({ state: "cancelled" });
    expect(sessions.checks()).toEqual([]);
    const moved = working(0);
    moved.report(report("PermissionRequest", { tool: "Bash" }), 5000);
    expect(moved.interrupted(SESSION, 0)).toBeNull();
  });

  it("lets go of a session that has been quiet too long", () => {
    const running = working(0);
    expect(running.expire(CLAUDE_CONFIG.staleRunningMs)).toEqual([]);
    expect(running.expire(CLAUDE_CONFIG.staleRunningMs + 1)).toEqual([expect.objectContaining({ state: "cancelled" })]);
    const waiting = working(0);
    waiting.report(report("PermissionRequest", { tool: "Bash" }), 0);
    expect(waiting.expire(CLAUDE_CONFIG.staleRunningMs + 1)).toEqual([]);
    expect(waiting.expire(CLAUDE_CONFIG.staleWaitingMs + 1)).toHaveLength(1);
  });

  it("fits a long folder name into the chip and the line", () => {
    const update = working().report(report("PermissionRequest", { project: "a-very-long-project-folder-name-for-testing", tool: "Bash" }), 1);
    expect(update?.label).toBe("a-very-long…");
    expect(update?.text).toBe("a-very-long-project-fol… 里的 Claude 想用 Bash，等你点头");
    expect(activityUpdateSchema.safeParse(update).success).toBe(true);
  });

  it("fits a name with emoji into the chip as the schema counts it", () => {
    const update = new ClaudeSessions().report(report("UserPromptSubmit", { project: "🚀".repeat(20) }), 0);
    expect(activityUpdateSchema.safeParse(update).success).toBe(true);
    expect(update?.label).toBe(`${"🚀".repeat(5)}…`);
  });

  it("names it Claude when there is no folder", () => {
    const sessions = new ClaudeSessions();
    expect(sessions.report(report("UserPromptSubmit", { project: "" }), 0)?.label).toBe("Claude");
    expect(sessions.report(report("PermissionRequest", { project: "", tool: "Bash" }), 1)?.text).toBe("Claude 想用 Bash，等你点头");
  });
});
