import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentReport } from "../types";
import { CODING_REACTIONS_KEY } from "../preferences/CodingPreferences";
import { loadCodingSessions } from "./codingStore";

const hooks: { handler: ((report: AgentReport) => void) | null; over: "interrupted" | "ended" | null; title: string | null } = { handler: null, over: null, title: null };
const recordWork = vi.fn(async () => {});
const reveal = vi.fn(async () => {});

vi.mock("../platform/agents", () => ({
  agentPlatform: {
    onReport: (handler: (report: AgentReport) => void) => { hooks.handler = handler; return () => { hooks.handler = null; }; },
    turnOver: async () => hooks.over,
    title: async () => hooks.title,
    reveal,
  },
}));
vi.mock("../worklog/store", () => ({ recordWork }));

const { followClaude, revealClaude } = await import("./followClaude");

const SESSION = "51595e2a-65fa-42e0-96d7-8ba91d2c7fa1";
const hook = (event: AgentReport["event"], extra: Partial<AgentReport> = {}) => hooks.handler?.({ event, session: SESSION, project: "ai-pet", ...extra });
const states = (reported: ReturnType<typeof vi.fn>) => reported.mock.calls.map(([update]) => update.state);

describe("followClaude", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const kept = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); } } });
    hooks.over = null; hooks.title = null; recordWork.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("reports each change, keeps the session, and writes a long turn into the work log", () => {
    const reported = vi.fn();
    const stop = followClaude(reported);
    hook("UserPromptSubmit", { task: "重构设置页面" });
    expect(loadCodingSessions()).toMatchObject([{ id: SESSION, turn: "working", task: "重构设置页面" }]);
    vi.advanceTimersByTime(60_000);
    hook("Stop", { summary: "改好了" });
    expect(states(reported)).toEqual(["running", "done"]);
    expect(loadCodingSessions()).toMatchObject([{ turn: "completed", result: "改好了" }]);
    expect(recordWork).toHaveBeenCalledWith([{ kind: "agent_turn_done", text: "ai-pet", before: null, itemId: null }], "agent");
    stop();
    expect(hooks.handler).toBeNull();
  });

  it("leaves a short turn out of the work log", () => {
    const stop = followClaude(vi.fn());
    hook("UserPromptSubmit");
    hook("Stop");
    expect(recordWork).not.toHaveBeenCalled();
    stop();
  });

  it("keeps what a tool is on without the pet reacting to it", () => {
    const reported = vi.fn();
    const stop = followClaude(reported);
    hook("UserPromptSubmit");
    hook("PreToolUse", { tool: "Edit", detail: "App.tsx" });
    expect(states(reported)).toEqual(["running"]);
    expect(loadCodingSessions()).toMatchObject([{ activity: "修改 App.tsx" }]);
    stop();
  });

  it("lets go of a turn the transcript shows was interrupted", async () => {
    const reported = vi.fn();
    const stop = followClaude(reported);
    hook("UserPromptSubmit");
    hooks.over = "interrupted";
    await vi.advanceTimersByTimeAsync(5000);
    expect(reported).toHaveBeenLastCalledWith(expect.objectContaining({ state: "cancelled" }));
    expect(loadCodingSessions()).toMatchObject([{ turn: "interrupted" }]);
    stop();
  });

  it("finishes a long turn whose Stop never came, by its transcript, with the whole folder name in the work log", async () => {
    const reported = vi.fn();
    const stop = followClaude(reported);
    hook("UserPromptSubmit", { project: "a-very-long-project-folder" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reported).toHaveBeenLastCalledWith(expect.objectContaining({ state: "running" }));
    hooks.over = "ended";
    await vi.advanceTimersByTimeAsync(5000);
    expect(reported).toHaveBeenLastCalledWith(expect.objectContaining({ state: "done" }));
    expect(recordWork).toHaveBeenCalledWith([expect.objectContaining({ text: "a-very-long-project-folder" })], "agent");
    stop();
  });

  it("takes Claude Code's own title for a session at work", async () => {
    const stop = followClaude(vi.fn());
    hook("UserPromptSubmit", { task: "继续" });
    hooks.title = "Roadmap 未完成事项";
    await vi.advanceTimersByTimeAsync(5000);
    expect(loadCodingSessions()).toMatchObject([{ name: "Roadmap 未完成事项", task: "继续" }]);
    stop();
  });

  it("brings back, after a restart, a session still waiting, and not one whose turn ended meanwhile", async () => {
    const first = followClaude(vi.fn());
    hook("UserPromptSubmit");
    hook("PermissionRequest", { tool: "Bash" });
    first();

    const reported = vi.fn();
    const still = followClaude(reported);
    await vi.advanceTimersByTimeAsync(0);
    expect(reported).toHaveBeenCalledWith(expect.objectContaining({ state: "waiting", text: "ai-pet 里的 Claude 想用 Bash，等你点头" }));
    still();

    hooks.over = "interrupted";
    const after = vi.fn();
    const gone = followClaude(after);
    await vi.advanceTimersByTimeAsync(0);
    expect(states(after)).toEqual(["cancelled"]);
    expect(loadCodingSessions()).toMatchObject([{ turn: "interrupted" }]);
    gone();
  });

  it("goes back to the terminal only for a Claude Code session", () => {
    revealClaude("claude:51595e2a");
    revealClaude("mail-code");
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith("51595e2a");
  });

  it("keeps the sessions but has the pet show nothing when its reactions are off", () => {
    window.localStorage.setItem(CODING_REACTIONS_KEY, "false");
    const reported = vi.fn();
    const stop = followClaude(reported);
    hook("UserPromptSubmit");
    hook("PermissionRequest", { tool: "Bash" });
    expect(reported.mock.calls.map(([update]) => [update.state, update.text])).toEqual([["cancelled", undefined], ["cancelled", undefined]]);
    expect(loadCodingSessions()).toMatchObject([{ turn: "waiting" }]);
    stop();
  });
});
