import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentReport } from "../types";

const hooks: { handler: ((report: AgentReport) => void) | null; interrupted: boolean } = { handler: null, interrupted: false };
const recordWork = vi.fn(async () => {});

vi.mock("../platform/agents", () => ({
  agentPlatform: {
    onReport: (handler: (report: AgentReport) => void) => { hooks.handler = handler; return () => { hooks.handler = null; }; },
    interrupted: async () => hooks.interrupted,
  },
}));
vi.mock("../worklog/store", () => ({ recordWork }));

const { followClaude } = await import("./followClaude");

const SESSION = "51595e2a-65fa-42e0-96d7-8ba91d2c7fa1";
const hook = (event: AgentReport["event"], extra: Partial<AgentReport> = {}) => hooks.handler?.({ event, session: SESSION, project: "ai-pet", ...extra });

describe("followClaude", () => {
  beforeEach(() => { vi.useFakeTimers(); hooks.interrupted = false; recordWork.mockClear(); });
  afterEach(() => vi.useRealTimers());

  it("reports each change and writes a long turn into the work log", () => {
    const reported = vi.fn();
    const stop = followClaude(reported);
    hook("UserPromptSubmit");
    vi.advanceTimersByTime(60_000);
    hook("Stop");
    expect(reported.mock.calls.map(([update]) => update.state)).toEqual(["running", "done"]);
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

  it("drops the chip when the transcript shows an interruption", async () => {
    const reported = vi.fn();
    const stop = followClaude(reported);
    hook("UserPromptSubmit");
    hooks.interrupted = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(reported).toHaveBeenLastCalledWith(expect.objectContaining({ state: "cancelled" }));
    stop();
  });
});
