import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { requestPreferences } from "./ChatPreferences";
import { CHAT_RULE_LIMIT, loadChatRules, saveChatRule } from "./ChatRules";
import { loadDeveloperMode, saveDeveloperMode } from "./DeveloperMode";

describe("chat rules", () => {
  it("sends rewritten parts with every character's request, and drops a part reset to default", () => {
    const storage = createMemoryStorage();
    saveChatRule("actions", "只在用户要求时做动作。", storage);
    saveChatRule("lookup", "", storage);
    expect(requestPreferences("girl", undefined, storage).rules).toEqual({ actions: "只在用户要求时做动作。", lookup: "" });
    expect(requestPreferences("cat", undefined, storage).rules.actions).toBe("只在用户要求时做动作。");
    saveChatRule("actions", null, storage);
    saveChatRule("lookup", null, storage);
    expect(loadChatRules(storage)).toEqual({});
    expect(storage.length).toBe(0);
  });
  it("rejects an overlong part without overwriting the saved one", () => {
    const storage = createMemoryStorage();
    saveChatRule("memory", "保留", storage);
    expect(() => saveChatRule("memory", "a".repeat(CHAT_RULE_LIMIT + 1), storage)).toThrow();
    expect(loadChatRules(storage).memory).toBe("保留");
  });
  it("ignores unreadable saved rules", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:chat-rules:v1", "{\"memory\": 1}");
    expect(loadChatRules(storage)).toEqual({});
  });
});

describe("developer mode", () => {
  it("is off until turned on, and asks requests to be kept while on", () => {
    const storage = createMemoryStorage();
    expect(requestPreferences("girl", undefined, storage).record).toBe(false);
    saveDeveloperMode(true, storage);
    expect(loadDeveloperMode(storage)).toBe(true);
    expect(requestPreferences("girl", undefined, storage).record).toBe(true);
    saveDeveloperMode(false, storage);
    expect(loadDeveloperMode(storage)).toBe(false);
  });
});
