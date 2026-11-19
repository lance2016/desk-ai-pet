import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { addFact, chatFacts, editFact, FACT_LIMITS, loadFactLearning, loadFacts, removeFact, restoreFact, saveFactLearning, updateFacts, type Fact } from "./FactStore";

const fact = (id: string, text: string, source: Fact["source"], at: number): Fact => ({ id, text, source, at });

describe("facts", () => {
  it("keeps one line per fact, oldest first", () => {
    const storage = createMemoryStorage();
    updateFacts((facts) => addFact(facts, { id: "b", text: "  做前端\n开发  ", source: "chat" }, 2), storage);
    updateFacts((facts) => addFact(facts, { id: "a", text: "不吃香菜", source: "user" }, 1), storage);
    expect(loadFacts(storage)).toEqual([fact("a", "不吃香菜", "user", 1), fact("b", "做前端 开发", "chat", 2)]);
  });

  it("refuses a fact over the limit, and a full list", () => {
    expect(() => addFact([], { id: "a", text: "字".repeat(FACT_LIMITS.text + 1), source: "user" }, 1)).toThrow();
    const full = Array.from({ length: FACT_LIMITS.items }, (_, index) => fact(`f${index}`, `事实 ${index}`, "chat", index));
    expect(() => addFact(full, { id: "new", text: "再来一条", source: "user" }, 99)).toThrow();
  });

  it("edits a fact under its new source, and puts it back as it was", () => {
    const before = fact("a", "住在深圳", "chat", 1);
    const edited = editFact([before], "a", "住在上海", "user", 5);
    expect(edited).toEqual([fact("a", "住在上海", "user", 5)]);
    expect(restoreFact(edited, before)).toEqual([before]);
    expect(restoreFact(removeFact(edited, "a"), before)).toEqual([before]);
  });

  it("drops a broken entry instead of the whole list", () => {
    const storage = createMemoryStorage({ "ai-pet:facts:v1": JSON.stringify([fact("a", "不吃香菜", "user", 1), { id: "b", text: "" }]) });
    expect(loadFacts(storage)).toEqual([fact("a", "不吃香菜", "user", 1)]);
  });

  it("learns from chats until the user turns it off", () => {
    const storage = createMemoryStorage();
    expect(loadFactLearning(storage)).toBe(true);
    saveFactLearning(false, storage);
    expect(loadFactLearning(storage)).toBe(false);
  });

  it("gives chats the user's facts as they are and numbers only the learned ones", () => {
    const facts = [fact("a", "不吃香菜", "user", 1), fact("b", "做前端", "chat", 2), fact("c", "养了一只猫", "chat", 3)];
    expect(chatFacts(facts, true)).toEqual({
      mine: ["不吃香菜"],
      learned: [{ ref: "m1", id: "b", text: "做前端" }, { ref: "m2", id: "c", text: "养了一只猫" }],
      learning: true,
    });
  });
});
