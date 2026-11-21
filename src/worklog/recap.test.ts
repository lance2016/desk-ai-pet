import { describe, expect, it } from "vitest";
import { agentWork, dayRecap, hasNews } from "./recap";

const turn = (day: string, project: string) => ({ at: 0, day, kind: "agent_turn_done", source: "agent", text: project, before: null, itemId: null });

describe("Claude Code turns in the day's recap", () => {
  it("counts the turns of each project, most first, also on folded days", () => {
    const log = {
      events: [turn("2026-11-21", "robot"), turn("2026-11-21", "ai-pet"), turn("2026-11-21", "ai-pet"), turn("2026-11-20", "ai-pet")],
      counts: [{ day: "2026-11-21", kind: "agent_turn_done", count: 2 }],
    };
    const recap = dayRecap(log, "2026-11-21");
    expect(recap.agentTurnCount).toBe(5);
    expect(agentWork(recap)).toBe("让 Claude Code 干完了 5 轮活：ai-pet 2 轮、robot 1 轮");
  });

  it("makes a day with only agent work worth telling", () => {
    const recap = dayRecap({ events: [turn("2026-11-21", "ai-pet")], counts: [] }, "2026-11-21");
    expect(hasNews(recap)).toBe(true);
    expect(agentWork(recap)).toBe("让 Claude Code 干完了 1 轮活：ai-pet 1 轮");
  });

  it("has nothing to say without turns, and no names for a folded day", () => {
    expect(agentWork(dayRecap({ events: [], counts: [] }, "2026-11-21"))).toBeNull();
    expect(agentWork(dayRecap({ events: [], counts: [{ day: "2026-11-01", kind: "agent_turn_done", count: 3 }] }, "2026-11-01"))).toBe("让 Claude Code 干完了 3 轮活");
  });
});
