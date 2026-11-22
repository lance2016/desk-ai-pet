import { describe, expect, it } from "vitest";
import { activityUpdateSchema } from "../activity/Activity";
import type { AgentReport } from "../types";
import { CLAUDE_CONFIG, ClaudeSessions } from "./ClaudeSessions";
import { codingSessionSchema } from "./CodingSession";

const SESSION = "51595e2a-65fa-42e0-96d7-8ba91d2c7fa1";
const OTHER = "8d0c1f7e-0000-4000-8000-000000000002";
const ID = `claude:${SESSION}`;
const report = (event: AgentReport["event"], extra: Partial<AgentReport> = {}): AgentReport => ({ event, session: SESSION, project: "ai-pet", ...extra });

/** A session that has been working since `at`. */
function working(at = 1) {
  const sessions = new ClaudeSessions();
  sessions.report(report("UserPromptSubmit", { task: "重构设置页面" }), at);
  return sessions;
}

const only = (sessions: ClaudeSessions) => sessions.list()[0];

describe("ClaudeSessions", () => {
  it("has the pet react once a prompt is sent, with no chip of its own", () => {
    const sessions = new ClaudeSessions();
    expect(sessions.report(report("UserPromptSubmit"), 1)).toEqual({ id: ID, state: "running", label: "ai-pet", icon: "agent", noChip: true });
  });

  it("knows a session from the moment it starts, idle until asked something", () => {
    const sessions = new ClaudeSessions();
    expect(sessions.report(report("SessionStart", { branch: "feat/settings", revealable: true }), 1)).toBeNull();
    expect(only(sessions)).toMatchObject({ id: SESSION, provider: "claude-code", project: "ai-pet", branch: "feat/settings", turn: "idle", ended: false, revealable: true });
    // Sent again mid-turn after a compaction: the turn goes on.
    sessions.report(report("UserPromptSubmit"), 2);
    sessions.report(report("SessionStart"), 3);
    expect(only(sessions).turn).toBe("working");
  });

  it("keeps what the turn is about, where, and what it is on", () => {
    const sessions = working(1000);
    sessions.report(report("PreToolUse", { tool: "Edit", detail: "SettingsView.tsx", branch: "main" }), 2000);
    expect(only(sessions)).toMatchObject({ task: "重构设置页面", activity: "修改 SettingsView.tsx", turn: "working", turnStartedAt: 1000, lastEventAt: 2000 });
    sessions.report(report("PreToolUse", { tool: "Bash", detail: "Run the tests" }), 3000);
    expect(only(sessions).activity).toBe("Run the tests");
    // Bookkeeping says nothing new; a tool without a description still says what kind of step it is.
    sessions.report(report("PreToolUse", { tool: "TodoWrite" }), 3500);
    expect(only(sessions).activity).toBe("Run the tests");
    sessions.report(report("PreToolUse", { tool: "Grep" }), 4000);
    expect(only(sessions).activity).toBe("搜索代码");
    sessions.report(report("PreToolUse", { tool: "mcp__github__create_issue" }), 5000);
    expect(only(sessions).activity).toBe("使用 create_issue");
  });

  it("does not have the pet react to each tool of a turn", () => {
    const sessions = working();
    expect(sessions.report(report("PreToolUse", { tool: "Read", detail: "a.ts" }), 2)).toBeNull();
    expect(sessions.report(report("PostToolUse", { tool: "Read" }), 3)).toBeNull();
    expect(sessions.report(report("PreToolUse", { tool: "Edit", detail: "a.ts" }), 4)).toBeNull();
  });

  it("offers a way back to the terminal on a line about a question or a failure, when the pet knows where it runs", () => {
    const sessions = new ClaudeSessions();
    sessions.report(report("UserPromptSubmit", { revealable: true }), 1);
    expect(sessions.report(report("PermissionRequest", { tool: "Bash" }), 2)).toMatchObject({ state: "waiting", opens: "回到终端" });
    expect(sessions.report(report("StopFailure", { error: "rate_limit" }), 3)).toMatchObject({ state: "failed", opens: "回到终端" });
    expect(sessions.activity(SESSION)).toBeNull();
    // Starting and finishing need no button; nor a session whose terminal is unknown.
    sessions.report(report("UserPromptSubmit"), 4);
    expect(sessions.report(report("Stop"), 4 + 60_000)).not.toHaveProperty("opens");
    expect(working().report(report("PermissionRequest", { tool: "Bash" }), 2)).not.toHaveProperty("opens");
  });

  it("asks the user, naming the tool and what it is for, when Claude wants permission", () => {
    const sessions = working();
    expect(sessions.report(report("PermissionRequest", { tool: "Bash" }), 1000)).toMatchObject({ id: ID, state: "waiting", text: "ai-pet 里的 Claude 想用 Bash，等你点头" });
    expect(only(sessions)).toMatchObject({ turn: "waiting", asking: "想用 Bash，等你点头", waitingFor: "Bash" });
    expect(working().report(report("PermissionRequest", { tool: "Edit", detail: "App.tsx" }), 1000)).toMatchObject({ text: "ai-pet 里的 Claude 想改 App.tsx，等你点头" });
    expect(working().report(report("PermissionRequest", { tool: "Bash", detail: "Clean the build" }), 1000)).toMatchObject({ text: "ai-pet 里的 Claude 想用 Bash（Clean the build），等你点头" });
  });

  it("says a question or a plan in plain words, and shortens an MCP tool to its own name", () => {
    expect(working().report(report("PermissionRequest", { tool: "AskUserQuestion" }), 1000)).toMatchObject({ text: "ai-pet 里的 Claude 有话问你" });
    expect(working().report(report("PermissionRequest", { tool: "ExitPlanMode" }), 1000)).toMatchObject({ text: "ai-pet 里的 Claude 写好计划了，等你过目" });
    expect(working().report(report("PermissionRequest", { tool: "mcp__github__create_issue" }), 1000)).toMatchObject({ text: "ai-pet 里的 Claude 想用 create_issue，等你点头" });
  });

  it("goes back to work once the tool it asked for has run, keeping the turn's start", () => {
    const sessions = working(1000);
    sessions.report(report("PermissionRequest", { tool: "Bash" }), 5000);
    expect(sessions.report(report("PostToolUse", { tool: "Bash" }), 9000)).toMatchObject({ id: ID, state: "running" });
    expect(only(sessions)).toMatchObject({ turn: "working", turnStartedAt: 1000 });
    expect(only(sessions)).not.toHaveProperty("asking");
  });

  it("keeps waiting while another tool running alongside starts or finishes", () => {
    const sessions = working();
    sessions.report(report("PermissionRequest", { tool: "Bash" }), 1000);
    expect(sessions.report(report("PostToolUse", { tool: "Read" }), 2000)).toBeNull();
    expect(sessions.report(report("PreToolUse", { tool: "Read", detail: "a.ts" }), 2500)).toBeNull();
    expect(only(sessions).turn).toBe("waiting");
    expect(sessions.report(report("PostToolUse", { tool: "Bash" }), 3000)).toMatchObject({ state: "running" });
  });

  it("lets a subagent's tools keep a session alive but never start or change one", () => {
    const sessions = new ClaudeSessions();
    expect(sessions.report(report("PostToolUse", { tool: "Read", subagent: true }), 1)).toBeNull();
    expect(sessions.report(report("PreToolUse", { tool: "Read", subagent: true }), 2)).toBeNull();
    expect(sessions.list()).toEqual([]);
    sessions.report(report("UserPromptSubmit"), 10);
    sessions.report(report("PermissionRequest", { tool: "Bash" }), 1000);
    expect(sessions.report(report("PostToolUse", { tool: "Bash", subagent: true }), 2000)).toBeNull();
    expect(only(sessions)).toMatchObject({ turn: "waiting", lastEventAt: 2000 });
  });

  it("falls back to a permission notification only when no request came first", () => {
    const sessions = working();
    expect(sessions.report(report("Notification", { notification: "permission_prompt" }), 1000)).toMatchObject({ state: "waiting", text: "ai-pet 里的 Claude 在等你确认" });
    // Without knowing the tool, any tool finishing means the user answered.
    expect(sessions.report(report("PostToolUse", { tool: "Read" }), 2000)).toMatchObject({ state: "running" });
    sessions.report(report("PermissionRequest", { tool: "Bash" }), 3000);
    expect(sessions.report(report("Notification", { notification: "permission_prompt" }), 9000)).toBeNull();
    expect(sessions.report(report("Notification", { notification: "auth_success" }), 9500)).toBeNull();
  });

  it("tells a long turn's end with how long it took, and lets a short one go quietly", () => {
    const long = working(1000);
    expect(long.report(report("Stop", { summary: "设置页改好了，测试通过。" }), 1000 + 4 * 60_000)).toMatchObject({ id: ID, state: "done", text: "ai-pet 那边这一轮做完了，用了 4 分钟" });
    const short = working(1000);
    expect(short.report(report("Stop"), 1000 + CLAUDE_CONFIG.shortTurnMs - 1)).toMatchObject({ state: "cancelled" });
  });

  it("keeps a session whose turn ended as a recent one, with how the turn came out", () => {
    const sessions = working(1000);
    sessions.report(report("PreToolUse", { tool: "Edit", detail: "a.ts" }), 2000);
    sessions.report(report("Stop", { summary: "设置页改好了，测试通过。" }), 61_000);
    expect(only(sessions)).toMatchObject({ turn: "completed", ended: false, result: "设置页改好了，测试通过。", turnStartedAt: 1000, turnEndedAt: 61_000, task: "重构设置页面" });
    expect(only(sessions)).not.toHaveProperty("activity");
    // A second Stop changes nothing; the next prompt starts a new turn and clears the old result.
    expect(sessions.report(report("Stop"), 62_000)).toBeNull();
    expect(only(sessions).turn).toBe("completed");
    sessions.report(report("UserPromptSubmit", { task: "再把深色模式补上" }), 70_000);
    expect(only(sessions)).toMatchObject({ turn: "working", task: "再把深色模式补上", turnStartedAt: 70_000 });
    expect(only(sessions)).not.toHaveProperty("result");
    expect(only(sessions).turnEndedAt).toBeUndefined();
  });

  it("says why a turn failed in the user's words", () => {
    const sessions = working();
    expect(sessions.report(report("StopFailure", { error: "rate_limit" }), 1000)).toMatchObject({ state: "failed", text: "ai-pet 那边停下了：额度用完了" });
    expect(only(sessions)).toMatchObject({ turn: "failed", result: "额度用完了" });
    expect(working().report(report("StopFailure", { error: "something_new" }), 1000)).toMatchObject({ text: "ai-pet 那边停下了：出错了" });
  });

  it("takes a session that was already working when the pet started", () => {
    const sessions = new ClaudeSessions();
    expect(sessions.report(report("PostToolUse", { tool: "Read" }), 5000)).toMatchObject({ state: "running" });
    expect(only(sessions)).toMatchObject({ turn: "working", turnStartedAt: 5000 });
    const asked = new ClaudeSessions();
    expect(asked.report(report("PermissionRequest", { tool: "Bash" }), 5000)).toMatchObject({ state: "waiting" });
    expect(asked.report(report("Stop"), 5000 + 60_000)).toMatchObject({ state: "done" });
  });

  it("ignores an event whose hook ran before the turn ended or began, however late it arrives", () => {
    const sessions = working(1000);
    sessions.report(report("Stop", { at: 50_000 }), 50_010);
    // The tool's hook ran before the Stop's but got through after it.
    expect(sessions.report(report("PostToolUse", { tool: "Edit", at: 49_990 }), 50_020)).toBeNull();
    expect(sessions.report(report("PreToolUse", { tool: "Edit", at: 49_000 }), 50_030)).toBeNull();
    expect(only(sessions).turn).toBe("completed");
    // And the old turn's Stop does not end the next turn.
    sessions.report(report("UserPromptSubmit", { at: 60_000 }), 60_000);
    expect(sessions.report(report("Stop", { at: 55_000 }), 60_050)).toBeNull();
    expect(only(sessions).turn).toBe("working");
  });

  it("keeps sessions in the same folder apart, each with its own state", () => {
    const sessions = new ClaudeSessions();
    sessions.report(report("UserPromptSubmit", { task: "修拖放" }), 1000);
    sessions.report(report("UserPromptSubmit", { session: OTHER, task: "写文档" }), 2000);
    sessions.report(report("PermissionRequest", { session: OTHER, tool: "Bash" }), 3000);
    expect(sessions.list().map((session) => [session.id, session.turn, session.task])).toEqual([[OTHER, "waiting", "写文档"], [SESSION, "working", "修拖放"]]);
    // One stopping leaves the other as it was.
    expect(sessions.report(report("Stop"), 4000)).toMatchObject({ id: ID, state: "cancelled" });
    expect(sessions.list().find((session) => session.id === OTHER)?.turn).toBe("waiting");
  });

  it("marks a session over when it ends, without calling its last turn finished", () => {
    const sessions = working();
    expect(sessions.report(report("SessionEnd"), 1000)).toEqual({ id: ID, state: "cancelled", label: "ai-pet", icon: "agent", noChip: true });
    expect(only(sessions)).toMatchObject({ turn: "idle", ended: true, revealable: false });
    expect(new ClaudeSessions().report(report("SessionEnd"), 1)).toBeNull();
    // A turn that had finished stays finished; resuming the session brings it back.
    const done = working(1000);
    done.report(report("Stop", { summary: "好了" }), 2000);
    expect(done.report(report("SessionEnd"), 3000)).toBeNull();
    expect(only(done)).toMatchObject({ turn: "completed", ended: true, result: "好了" });
    done.report(report("SessionStart"), 4000);
    expect(only(done).ended).toBe(false);
  });

  it("calls a turn off when the transcript says the user interrupted it, unless something happened since", () => {
    const sessions = working(1000);
    expect(sessions.checks()).toEqual([{ session: SESSION, since: 1000 }]);
    sessions.report(report("PreToolUse", { tool: "Read" }), 2000);
    expect(sessions.turnOver(SESSION, 1000, "interrupted", 3000)).toBeNull();
    expect(sessions.turnOver(SESSION, 2000, "interrupted", 3000)).toMatchObject({ id: ID, state: "cancelled" });
    expect(only(sessions)).toMatchObject({ turn: "interrupted", turnEndedAt: 3000 });
    expect(sessions.checks()).toEqual([]);
    expect(sessions.turnOver(SESSION, 2000, "interrupted", 4000)).toBeNull();
  });

  it("ends a turn whose Stop went missing as a Stop would have", () => {
    expect(working(1000).turnOver(SESSION, 1000, "ended", 1000 + 4 * 60_000)).toMatchObject({ state: "done", text: "ai-pet 那边这一轮做完了，用了 4 分钟" });
    expect(working(1000).turnOver(SESSION, 1000, "ended", 2000)).toMatchObject({ state: "cancelled" });
  });

  it("stops saying a silent session works, without calling it finished", () => {
    const sessions = working(1000);
    expect(sessions.expire(1000 + CLAUDE_CONFIG.staleRunningMs)).toEqual([]);
    expect(sessions.expire(1001 + CLAUDE_CONFIG.staleRunningMs)).toEqual([{ id: ID, state: "cancelled", label: "ai-pet", icon: "agent", noChip: true }]);
    expect(only(sessions)).toMatchObject({ turn: "unknown" });
    expect(only(sessions).turnEndedAt).toBeUndefined();
    // Its next event shows it was alive after all.
    expect(sessions.report(report("PostToolUse", { tool: "Bash" }), 2000 + CLAUDE_CONFIG.staleRunningMs)).toMatchObject({ state: "running" });
    // One waiting for the user is given much longer.
    const asked = working(1000);
    asked.report(report("PermissionRequest", { tool: "Bash" }), 1000);
    expect(asked.expire(1001 + CLAUDE_CONFIG.staleRunningMs)).toEqual([]);
    expect(asked.expire(1001 + CLAUDE_CONFIG.staleWaitingMs)).toHaveLength(1);
  });

  it("drops recent sessions that are old or too many, never one still going", () => {
    const sessions = new ClaudeSessions();
    const ids = Array.from({ length: CLAUDE_CONFIG.recentKept + 2 }, (_, index) => `s-${index}`);
    for (const [index, session] of ids.entries()) {
      sessions.report(report("UserPromptSubmit", { session }), 1000 + index);
      if (index > 0) sessions.report(report("Stop", { session }), 2000 + index);
    }
    sessions.expire(3000);
    const kept = sessions.list().map((session) => session.id);
    expect(kept).toHaveLength(CLAUDE_CONFIG.recentKept + 1);
    expect(kept).toContain("s-0");
    expect(kept).not.toContain("s-1");
    sessions.report(report("PreToolUse", { session: "s-0", tool: "Read" }), 4000 + CLAUDE_CONFIG.recentMs);
    sessions.expire(4000 + CLAUDE_CONFIG.recentMs);
    expect(sessions.list().map((session) => session.id)).toEqual(["s-0"]);
  });

  it("picks up where the last run left off", () => {
    const before = working(1000);
    before.report(report("PermissionRequest", { tool: "Bash", revealable: true }), 2000);
    const sessions = new ClaudeSessions(before.list());
    expect(sessions.checks()).toEqual([{ session: SESSION, since: 2000 }]);
    expect(sessions.activity(SESSION)).toMatchObject({ id: ID, state: "waiting", text: "ai-pet 里的 Claude 想用 Bash，等你点头" });
    expect(sessions.report(report("PostToolUse", { tool: "Bash" }), 3000)).toMatchObject({ state: "running" });
    expect(sessions.activity(SESSION)).toMatchObject({ state: "running" });
    sessions.report(report("Stop"), 4000);
    expect(sessions.activity(SESSION)).toBeNull();
  });

  it("names a session as the user did, else as Claude Code does", () => {
    const sessions = working();
    expect(sessions.rename(SESSION, "  Roadmap 未完成事项 ")).toBe(true);
    expect(sessions.rename(SESSION, "Roadmap 未完成事项")).toBe(false);
    expect(only(sessions).name).toBe("Roadmap 未完成事项");
    sessions.report(report("UserPromptSubmit", { title: "设置页" }), 2000);
    expect(sessions.rename(SESSION, "Claude 自己起的名字")).toBe(false);
    expect(only(sessions).name).toBe("设置页");
    expect(sessions.rename("unknown", "x")).toBe(false);
  });

  it("fits long and odd names into what is shown and saved", () => {
    const sessions = new ClaudeSessions();
    const long = sessions.report(report("PermissionRequest", { project: "a-very-long-project-folder-name-indeed", tool: `mcp__server__${"t".repeat(100)}`, detail: "长".repeat(128) }), 1);
    expect(long).toMatchObject({ label: "a-very-long…" });
    expect(activityUpdateSchema.safeParse(long).success).toBe(true);
    const emoji = sessions.report(report("UserPromptSubmit", { session: OTHER, project: "🎉🎉🎉🎉🎉🎉🎉🎉", task: "长".repeat(160), branch: "b".repeat(128) }), 2);
    expect(activityUpdateSchema.safeParse(emoji).success).toBe(true);
    sessions.report(report("Stop", { session: OTHER, summary: "果".repeat(320) }), 3);
    for (const session of sessions.list()) expect(codingSessionSchema.safeParse(session).success).toBe(true);
  });

  it("names it Claude when there is no folder", () => {
    const sessions = new ClaudeSessions();
    expect(sessions.report(report("UserPromptSubmit", { project: "" }), 1)).toMatchObject({ label: "Claude" });
    expect(sessions.report(report("PermissionRequest", { project: "", tool: "Bash" }), 1000)).toMatchObject({ text: "Claude 想用 Bash，等你点头" });
  });
});
