import { describe, expect, it } from "vitest";
import { RESULT_FRESH_MS, overview, resumeCommand, sessionTitle, stateLine, stateWord, type CodingSession } from "./CodingSession";

const NOW = 10_000_000;
const build = (id: string, turn: CodingSession["turn"], extra: Partial<CodingSession> = {}): CodingSession =>
  ({ id, provider: "claude-code", project: "ai-pet", turn, ended: false, revealable: true, lastEventAt: NOW - 1000, ...extra });

describe("overview", () => {
  it("puts a session waiting for the user ahead of everything, the one waiting longest first", () => {
    const view = overview([
      build("w1", "working"),
      build("a2", "waiting", { lastEventAt: NOW - 500 }),
      build("a1", "waiting", { lastEventAt: NOW - 9000 }),
      build("f", "failed", { turnEndedAt: NOW - 1000 }),
    ], NOW);
    expect(view.headline?.id).toBe("a1");
    expect(view.waiting.map((session) => session.id)).toEqual(["a1", "a2"]);
    expect(view.working.map((session) => session.id)).toEqual(["w1"]);
    expect(view.recent.map((session) => session.id)).toEqual(["f"]);
  });

  it("brings up a fresh failure before work going on, and work before a turn that just ended", () => {
    const working = build("w", "working");
    const failed = build("f", "failed", { turnEndedAt: NOW - 1000 });
    const completed = build("c", "completed", { turnEndedAt: NOW - 1000 });
    expect(overview([working, completed, failed], NOW).headline?.id).toBe("f");
    expect(overview([completed, working], NOW).headline?.id).toBe("w");
    expect(overview([completed], NOW).headline?.id).toBe("c");
  });

  it("does not bring an old result up again, nor a session that is idle, interrupted or unknown", () => {
    const stale = build("c", "completed", { turnEndedAt: NOW - RESULT_FRESH_MS });
    const view = overview([stale, build("i", "idle"), build("x", "interrupted", { turnEndedAt: NOW - 1000 }), build("u", "unknown")], NOW);
    expect(view.headline).toBeNull();
    expect(view.recent).toHaveLength(4);
    expect(overview([], NOW)).toEqual({ waiting: [], working: [], recent: [], closed: [], headline: null });
  });

  it("lists recent sessions the latest first", () => {
    const view = overview([build("old", "completed", { lastEventAt: NOW - 9000 }), build("new", "idle", { lastEventAt: NOW - 10 })], NOW);
    expect(view.recent.map((session) => session.id)).toEqual(["new", "old"]);
  });

  it("sets apart the sessions that ended, still bringing up a fresh result", () => {
    const view = overview([
      build("open", "completed"),
      // Still open, only its terminal is unknown (over ssh): not closed.
      build("remote", "completed", { revealable: false, lastEventAt: NOW - 20 }),
      build("gone", "completed", { ended: true, revealable: false, turnEndedAt: NOW - 1000 }),
      build("live", "working", { revealable: false }),
    ], NOW);
    expect(view.recent.map((session) => session.id)).toEqual(["remote", "open"]);
    expect(view.closed.map((session) => session.id)).toEqual(["gone"]);
    expect(view.working.map((session) => session.id)).toEqual(["live"]);
    expect(overview([build("gone", "completed", { revealable: false, turnEndedAt: NOW - 1000 })], NOW).headline?.id).toBe("gone");
  });
});

describe("what a session says about itself", () => {
  it("is titled by its name, else by what was asked, else plainly", () => {
    expect(sessionTitle(build("a", "working", { name: "设置页", task: "继续" }))).toBe("设置页");
    expect(sessionTitle(build("a", "working", { task: "重构设置页面" }))).toBe("重构设置页面");
    expect(sessionTitle(build("a", "working"))).toBe("Claude Code 会话");
  });

  it("tells a finished turn from a finished session, and never calls the task done", () => {
    expect(stateWord(build("a", "completed"))).toBe("这一轮做完了");
    expect(stateWord(build("a", "idle", { ended: true }))).toBe("会话已结束");
    expect(stateWord(build("a", "idle"))).toBe("空闲");
    expect(stateWord(build("a", "unknown"))).toBe("状态未知");
  });

  it("adds a line only when there is something real to say", () => {
    expect(stateLine(build("a", "working", { activity: "修改 App.tsx" }))).toBe("修改 App.tsx");
    expect(stateLine(build("a", "working"))).toBeNull();
    expect(stateLine(build("a", "waiting", { asking: "有话问你" }))).toBe("有话问你");
    expect(stateLine(build("a", "completed"))).toBeNull();
    expect(stateLine(build("a", "completed", { result: "测试通过" }))).toBe("测试通过");
    expect(stateLine(build("a", "unknown"))).toContain("很久没有动静");
  });

  it("gives the command that opens the session again", () => {
    expect(resumeCommand(build("51595e2a-65fa", "idle"))).toBe("claude --resume 51595e2a-65fa");
  });
});
