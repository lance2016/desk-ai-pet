import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall } from "../ai/skill";
import { hushedUntil } from "../companion/hush";
import { chatRequestContext, createMemoryStorage } from "../testing/fixtures";
import { quietSkill, STAY_QUIET_TOOL } from "./quiet";

const NOW = new Date(2026, 10, 18, 21, 0).getTime();
const MORNING = new Date(2026, 10, 19, 8, 0).getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("window", { localStorage: createMemoryStorage() });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const call = (): ToolCall => ({ requestId: "r1", context: chatRequestContext(), memo: new Map() });
const stayQuiet = (args: Record<string, unknown>) => quietSkill.tools.find((tool) => tool.name === STAY_QUIET_TOOL)!.run(args, call());

describe("stay_quiet", () => {
  it("keeps the pet to itself until the morning, and says until when", async () => {
    const outcome = await stayQuiet({ quiet: true });
    expect(hushedUntil(NOW)).toBe(MORNING);
    expect(outcome.lines?.[0]).toMatchObject({ kind: "quiet", text: "已安静：明天 08:00 前不主动说话" });
    expect(outcome.confirmation).toContain("提醒照常");
  });

  it("can be undone, back to how it was", async () => {
    const outcome = await stayQuiet({ quiet: true });
    outcome.lines?.[0].undo?.();
    expect(hushedUntil(NOW)).toBeNull();
  });

  it("lets the pet speak up again on request, and that can be undone too", async () => {
    await stayQuiet({ quiet: true });
    const outcome = await stayQuiet({ quiet: false });
    expect(hushedUntil(NOW)).toBeNull();
    expect(outcome.lines?.[0].text).toBe("已恢复主动说话");
    outcome.lines?.[0].undo?.();
    expect(hushedUntil(NOW)).toBe(MORNING);
  });

  it("changes nothing when there is nothing to lift, or the arguments make no sense", async () => {
    expect((await stayQuiet({ quiet: false })).lines).toBeUndefined();
    expect((await stayQuiet({})).lines?.[0].kind).toBe("failed");
    expect(hushedUntil(NOW)).toBeNull();
  });
});
