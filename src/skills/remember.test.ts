import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolCall, ToolOutcome } from "../ai/skill";
import { addFact, chatFacts, editFact, FACT_LIMITS, loadFacts, updateFacts, type Fact } from "../facts/FactStore";
import { chatRequestContext, createMemoryStorage } from "../testing/fixtures";
import { FORGET_TOOL, REMEMBER_TOOL, rememberSkill } from "./remember";

const NOW = new Date(2026, 10, 19, 14, 0).getTime();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("window", { localStorage: createMemoryStorage() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const keep = (id: string, text: string, source: Fact["source"]) => updateFacts((facts) => addFact(facts, { id, text, source }, NOW - 1000));
/** A call that sees the facts as they are now, as a new chat request would. */
const newCall = (): ToolCall => ({ requestId: "r1", context: chatRequestContext({ facts: chatFacts(loadFacts(), true) }), memo: new Map() });
async function use(name: string, args: Record<string, unknown>, call = newCall()): Promise<ToolOutcome> {
  const tool = rememberSkill.tools.find((item) => item.name === name);
  if (!tool) throw new Error(`No tool ${name}`);
  return tool.run(args, call);
}
const texts = () => loadFacts().map((fact) => `${fact.source}:${fact.text}`);

describe("remembering", () => {
  it("keeps what a chat learned as its own, and takes it back on undo", async () => {
    const outcome = await use(REMEMBER_TOOL, { text: " 是前端工程师 " });
    expect(texts()).toEqual(["chat:是前端工程师"]);
    expect(outcome).toMatchObject({ confirmation: "好，记住了", lines: [{ kind: "fact", text: "已记住：是前端工程师" }] });
    outcome.lines?.[0].undo?.();
    expect(loadFacts()).toEqual([]);
  });

  it("replaces a learned fact by its number and puts the old one back on undo", async () => {
    keep("home", "住在深圳", "chat");
    const outcome = await use(REMEMBER_TOOL, { text: "住在上海", replaces: "m1" });
    expect(texts()).toEqual(["chat:住在上海"]);
    expect(outcome.lines?.[0]).toMatchObject({ kind: "fact", text: "已更新记忆：住在上海" });
    outcome.lines?.[0].undo?.();
    expect(texts()).toEqual(["chat:住在深圳"]);
  });

  it("cannot name the user's own facts, which have no number", async () => {
    keep("mine", "住在深圳", "user");
    const outcome = await use(REMEMBER_TOOL, { text: "住在上海", replaces: "m1" });
    expect(outcome).toMatchObject({ needsModel: true, lines: [{ kind: "failed" }] });
    expect(texts()).toEqual(["user:住在深圳"]);
    expect((await use(FORGET_TOOL, { ref: "m1" })).lines?.[0].kind).toBe("failed");
    expect(texts()).toEqual(["user:住在深圳"]);
  });

  it("does not keep the same fact twice", async () => {
    keep("mine", "不吃香菜", "user");
    expect((await use(REMEMBER_TOOL, { text: "不吃香菜" })).lines).toBeUndefined();
    expect(loadFacts()).toHaveLength(1);
  });

  it("says when the list is full or there is nothing to keep", async () => {
    updateFacts(() => Array.from({ length: FACT_LIMITS.items }, (_, index) => ({ id: `f${index}`, text: `事实 ${index}`, source: "user" as const, at: index })));
    expect((await use(REMEMBER_TOOL, { text: "养了一只猫" })).lines?.[0]).toMatchObject({ kind: "failed", text: expect.stringContaining("记忆满了") });
    expect((await use(REMEMBER_TOOL, { text: "  " })).lines?.[0].kind).toBe("failed");
  });

  it("forgets a learned fact and brings it back on undo", async () => {
    keep("cat", "养了一只猫", "chat");
    const outcome = await use(FORGET_TOOL, { ref: "m1" });
    expect(loadFacts()).toEqual([]);
    expect(outcome).toMatchObject({ confirmation: "好，忘掉了", lines: [{ kind: "fact", text: "已忘掉：养了一只猫" }] });
    outcome.lines?.[0].undo?.();
    expect(texts()).toEqual(["chat:养了一只猫"]);
  });

  it("says when a numbered fact went away after the request started", async () => {
    keep("cat", "养了一只猫", "chat");
    const call = newCall();
    updateFacts(() => []);
    expect((await use(FORGET_TOOL, { ref: "m1" }, call)).lines?.[0]).toMatchObject({ kind: "failed", text: expect.stringContaining("已经不在了") });
  });

  it("leaves alone a learned fact the user rewrote after the request started", async () => {
    keep("home", "住在深圳", "chat");
    const call = newCall();
    updateFacts((facts) => editFact(facts, "home", "住在杭州", "user", NOW));
    expect((await use(REMEMBER_TOOL, { text: "住在上海", replaces: "m1" }, call)).lines?.[0].kind).toBe("failed");
    expect(texts()).toEqual(["user:住在杭州"]);
  });

  it("is offered only while chats may learn", () => {
    expect(rememberSkill.available?.(chatRequestContext())).toBe(true);
    expect(rememberSkill.available?.(chatRequestContext({ facts: { mine: [], learned: [], learning: false } }))).toBe(false);
  });
});
