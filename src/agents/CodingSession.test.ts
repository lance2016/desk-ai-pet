import { describe, expect, it } from "vitest";
import { RESULT_FRESH_MS, byProject, overview, pinnedFirst, resumeCommand, sessionTitle, stateLine, stateWord, type CodingSession } from "./CodingSession";

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
    expect(overview([], NOW)).toEqual({ waiting: [], working: [], headline: null });
  });

  it("brings up a turn left to background work as it does a turn that just ended", () => {
    const left = build("b", "background", { turnEndedAt: NOW - 1000 });
    expect(overview([left, build("c", "completed", { turnEndedAt: NOW - 5000 })], NOW).headline?.id).toBe("b");
    expect(overview([left, build("w", "working")], NOW).headline?.id).toBe("w");
    expect(overview([build("b", "background", { turnEndedAt: NOW - RESULT_FRESH_MS })], NOW).headline).toBeNull();
  });

  it("still brings up a fresh result of a session that ended", () => {
    expect(overview([build("gone", "completed", { ended: true, revealable: false, turnEndedAt: NOW - 1000 })], NOW).headline?.id).toBe("gone");
  });
});

describe("pinnedFirst", () => {
  const groups = byProject([
    build("ask", "waiting", { project: "ai-pet" }),
    build("busy", "working", { project: "robot" }),
    build("quiet", "completed", { project: "notes" }),
  ]);
  const names = (list: { project: string }[]) => list.map((group) => group.project);

  it("puts the pinned folder first, ahead of one waiting, and keeps the rest in order", () => {
    expect(names(pinnedFirst(groups, "notes"))).toEqual(["notes", "ai-pet", "robot"]);
  });

  it("changes nothing without a pin, or for a pinned folder with no sessions now", () => {
    expect(names(pinnedFirst(groups, null))).toEqual(["ai-pet", "robot", "notes"]);
    expect(names(pinnedFirst(groups, "gone"))).toEqual(["ai-pet", "robot", "notes"]);
  });
});

describe("byProject", () => {
  const ids = (sessions: CodingSession[]) => sessions.map((session) => session.id);

  it("groups sessions by folder, a folder with one waiting first, then one at work, then the latest", () => {
    const groups = byProject([
      build("quiet", "completed", { project: "notes", lastEventAt: NOW - 10 }),
      build("busy", "working", { project: "robot", lastEventAt: NOW - 9000 }),
      build("ask", "waiting", { project: "ai-pet", lastEventAt: NOW - 9000 }),
      build("old", "completed", { project: "docs", lastEventAt: NOW - 50_000 }),
    ]);
    expect(groups.map((group) => group.project)).toEqual(["ai-pet", "robot", "notes", "docs"]);
  });

  it("orders a folder's open sessions by what they need: waiting longest, then working, then the latest", () => {
    const [group] = byProject([
      build("done", "completed", { lastEventAt: NOW - 10 }),
      build("w-old", "working", { lastEventAt: NOW - 9000 }),
      build("a-new", "waiting", { lastEventAt: NOW - 100 }),
      build("w-new", "working", { lastEventAt: NOW - 20 }),
      build("a-old", "waiting", { lastEventAt: NOW - 9000 }),
      build("idle", "idle", { lastEventAt: NOW - 5 }),
    ]);
    expect(ids(group.open)).toEqual(["a-old", "a-new", "w-new", "w-old", "idle", "done"]);
  });

  it("keeps ended sessions apart, but not one whose terminal is only unknown", () => {
    const [group] = byProject([
      build("open", "completed"),
      // Still open, only its terminal is unknown (over ssh): not closed.
      build("remote", "completed", { revealable: false, lastEventAt: NOW - 20 }),
      build("gone", "completed", { ended: true, revealable: false, lastEventAt: NOW - 3000 }),
      build("gone-later", "idle", { ended: true, revealable: false, lastEventAt: NOW - 2000 }),
    ]);
    expect(ids(group.open)).toEqual(["remote", "open"]);
    expect(ids(group.closed)).toEqual(["gone-later", "gone"]);
  });

  it("puts a folder with only ended sessions after one with an open session", () => {
    const groups = byProject([
      build("gone", "completed", { project: "robot", ended: true, lastEventAt: NOW - 10 }),
      build("open", "completed", { project: "ai-pet", lastEventAt: NOW - 9000 }),
    ]);
    expect(groups.map((group) => group.project)).toEqual(["ai-pet", "robot"]);
  });

  it("says a folder's sessions are on different branches only when they are", () => {
    expect(byProject([build("a", "working", { branch: "main" }), build("b", "idle", { branch: "main" }), build("c", "idle")])[0].branched).toBe(false);
    expect(byProject([build("a", "working", { branch: "main" }), build("b", "idle", { branch: "feat/x" })])[0].branched).toBe(true);
    expect(byProject([])).toEqual([]);
  });
});

describe("what a session says about itself", () => {
  it("is titled by its name, else by what was asked, else plainly", () => {
    expect(sessionTitle(build("a", "working", { name: "设置页", task: "继续" }))).toBe("设置页");
    expect(sessionTitle(build("a", "working", { task: "重构设置页面" }))).toBe("重构设置页面");
    expect(sessionTitle(build("a", "working"))).toBe("Claude Code 会话");
    // A turn whose prompt the pet missed is still named by what was asked before it.
    expect(sessionTitle(build("a", "working", { earlier: [{ turn: "completed", task: "修拖放" }, { turn: "completed" }] }))).toBe("修拖放");
  });

  it("tells a finished turn from a finished session, and never calls the task done", () => {
    expect(stateWord(build("a", "completed"))).toBe("这一轮做完了");
    expect(stateWord(build("a", "idle", { ended: true }))).toBe("会话已结束");
    expect(stateWord(build("a", "idle"))).toBe("空闲");
    expect(stateWord(build("a", "unknown"))).toBe("状态未知");
    expect(stateWord(build("a", "background"))).toBe("后台还在跑");
  });

  it("adds a line only when there is something real to say", () => {
    expect(stateLine(build("a", "working", { activity: "修改 App.tsx" }))).toBe("修改 App.tsx");
    expect(stateLine(build("a", "working"))).toBeNull();
    expect(stateLine(build("a", "waiting", { asking: "有话问你" }))).toBe("有话问你");
    expect(stateLine(build("a", "completed"))).toBeNull();
    expect(stateLine(build("a", "completed", { result: "测试通过" }))).toBe("测试通过");
    expect(stateLine(build("a", "unknown"))).toContain("很久没有动静");
    expect(stateLine(build("a", "background", { result: "测试还在后台跑" }))).toBe("测试还在后台跑");
    expect(stateLine(build("a", "background"))).toBe("这一轮停了，跑完 Claude 会接着做");
  });

  it("gives the command that opens the session again", () => {
    expect(resumeCommand(build("51595e2a-65fa", "idle"))).toBe("claude --resume 51595e2a-65fa");
  });
});
