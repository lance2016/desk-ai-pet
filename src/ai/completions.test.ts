import { describe, expect, it, vi } from "vitest";
import { chatPreferences } from "../testing/fixtures";
import { greetingRequest, greetingText, testConnection } from "./completions";

const platform = vi.hoisted(() => ({ llmPlatform: { complete: vi.fn(), addStat: vi.fn(async (_stat: object) => {}), windowLabel: () => "settings" } }));
vi.mock("../platform/llm", () => ({ llmPlatform: platform.llmPlatform }));

describe("greetings", () => {
  it("reads the greeting without the quotes models add", () => {
    expect(greetingText(`{"choices":[{"message":{"content":" “早呀！” "}}]}`)).toBe("早呀！");
    expect(greetingText(`{"choices":[{"message":{"content":"  "}}]}`)).toBeNull();
    expect(greetingText("not json")).toBeNull();
  });

  it("asks in the character's voice with the day's facts", () => {
    const body = greetingRequest("morning", ["今天有 2 个提醒"], chatPreferences({ userName: "阿龙" }), "2026-11-19 08:30 周四") as unknown as { messages: Array<{ content: string }>; stream: boolean };
    expect(body.stream).toBe(false);
    expect(body.messages[0].content).toContain("称呼用户为「阿龙」。");
    expect(body.messages[1].content).toContain("向用户问好");
    expect(body.messages[1].content).toContain("- 今天有 2 个提醒");
  });
});

describe("testConnection", () => {
  it("tells a wrong model name apart from other failures", async () => {
    platform.llmPlatform.complete.mockResolvedValueOnce({ status: 200, ok: true, body: "{}" });
    await expect(testConnection("deepseek-flash")).resolves.toBeUndefined();
    platform.llmPlatform.complete.mockResolvedValueOnce({ status: 404, ok: false, body: "" });
    await expect(testConnection("deepseek-x")).rejects.toThrow("模型名不可用");
    platform.llmPlatform.complete.mockResolvedValueOnce({ status: 402, ok: false, body: "" });
    await expect(testConnection("deepseek-flash")).rejects.toThrow("余额不足");
  });

  it("records each try with the tokens the reply reports", async () => {
    platform.llmPlatform.addStat.mockClear();
    platform.llmPlatform.complete.mockResolvedValueOnce({ status: 200, ok: true, body: `{"usage":{"prompt_tokens":5,"completion_tokens":1,"prompt_cache_hit_tokens":0}}` });
    await testConnection("deepseek-flash");
    platform.llmPlatform.complete.mockResolvedValueOnce({ status: 401, ok: false, body: "not json" });
    await expect(testConnection("deepseek-flash")).rejects.toThrow();
    expect(platform.llmPlatform.addStat.mock.calls.map(([stat]) => stat)).toEqual([
      expect.objectContaining({ kind: "test", window: "settings", model: "deepseek-flash", ok: true, status: 200, firstTokenMs: null, promptTokens: 5, completionTokens: 1, cacheHitTokens: 0 }),
      expect.objectContaining({ kind: "test", ok: false, status: 401, promptTokens: null, completionTokens: null }),
    ]);
  });
});
