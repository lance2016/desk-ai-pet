import { describe, expect, it } from "vitest";
import { callArguments, MAX_TOOL_CALLS, parseStreamData, readUsage, ToolCallCollector } from "./stream";

describe("parseStreamData", () => {
  it("reads the tokens used from the last chunk, which has no choices", () => {
    const last = parseStreamData(`{"choices":[],"usage":{"prompt_tokens":900,"completion_tokens":12,"total_tokens":912,"prompt_cache_hit_tokens":640,"prompt_cache_miss_tokens":260}}`);
    expect(last).toMatchObject({ kind: "chunk", text: "", tools: [], usage: { promptTokens: 900, completionTokens: 12, cacheHitTokens: 640 } });
    expect(parseStreamData(`{"choices":[{"delta":{"content":"a"}}],"usage":null}`)).toMatchObject({ usage: null });
    expect(readUsage({ prompt_tokens: 5, completion_tokens: 1 })).toEqual({ promptTokens: 5, completionTokens: 1, cacheHitTokens: null });
    expect(readUsage({ prompt_tokens: -1, completion_tokens: 1 })).toBeNull();
    expect(readUsage("x")).toBeNull();
  });

  it("reads text, the end, errors and a reply cut off at the token limit", () => {
    expect(parseStreamData(`{"choices":[{"delta":{"content":"你好"}}]}`)).toMatchObject({ kind: "chunk", text: "你好", tools: [], truncated: false });
    expect(parseStreamData("[DONE]")).toEqual({ kind: "done" });
    expect(parseStreamData(`{"error":{}}`)).toEqual({ kind: "error" });
    expect(parseStreamData(`{"choices":[{"delta":{},"finish_reason":"length"}]}`)).toMatchObject({ kind: "chunk", text: "", truncated: true });
    expect(parseStreamData(`{"choices":[{"delta":{},"finish_reason":"content_filter"}]}`)).toEqual({ kind: "refused" });
    expect(parseStreamData("not json")).toEqual({ kind: "ignore" });
  });
});

describe("ToolCallCollector", () => {
  it("puts streamed tool calls back together", () => {
    const collector = new ToolCallCollector();
    for (const data of [
      `{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"add_reminder","arguments":"{\\"text"}}]}}]}`,
      `{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\":\\"开会\\"}"}}]}}]}`,
    ]) {
      const line = parseStreamData(data);
      if (line.kind !== "chunk") throw new Error("expected a chunk");
      collector.add(line.tools);
    }
    expect(collector.calls).toEqual([{ id: "c1", name: "add_reminder", arguments: `{"text":"开会"}`, overflow: false }]);
  });

  it("counts the calls past the limit", () => {
    const collector = new ToolCallCollector();
    const delta = (index: number) => ({ index, id: "", name: "save_note", arguments: "{}" });
    collector.add([delta(0), delta(MAX_TOOL_CALLS), delta(MAX_TOOL_CALLS + 1)]);
    expect(collector.calls).toHaveLength(1);
    expect(collector.droppedCount).toBe(2);
  });

  it("marks overlong arguments instead of cutting them", () => {
    const collector = new ToolCallCollector();
    collector.add([
      { index: 0, id: "c1", name: "save_note", arguments: `{"text":"` },
      { index: 0, id: "", name: "", arguments: "x".repeat(4_000) },
      { index: 0, id: "", name: "", arguments: `"}` },
    ]);
    expect(collector.calls[0]).toEqual({ id: "c1", name: "save_note", arguments: "", overflow: true });
    expect(callArguments(collector.calls[0])).toBeNull();
  });

  it("reads empty arguments as no arguments", () => {
    expect(callArguments({ id: "", name: "list_notes", arguments: " ", overflow: false })).toEqual({});
    expect(callArguments({ id: "", name: "list_notes", arguments: "[1]", overflow: false })).toBeNull();
  });
});
