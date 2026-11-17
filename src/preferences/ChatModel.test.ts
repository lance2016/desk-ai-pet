import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { DEFAULT_CHAT_MODEL, isBuiltInModel, loadChatModel, saveChatModel } from "./ChatModel";

describe("chat model", () => {
  it("defaults to deepseek-flash", () => {
    expect(DEFAULT_CHAT_MODEL).toBe("deepseek-flash");
    expect(loadChatModel(createMemoryStorage())).toBe("deepseek-flash");
  });

  it("keeps a built-in or a custom model name", () => {
    const storage = createMemoryStorage();
    saveChatModel("deepseek-pro", storage);
    expect(loadChatModel(storage)).toBe("deepseek-pro");
    saveChatModel("  deepseek-chat ", storage);
    expect(loadChatModel(storage)).toBe("deepseek-chat");
    expect(isBuiltInModel("deepseek-chat")).toBe(false);
    expect(isBuiltInModel("deepseek-pro")).toBe(true);
  });

  it.each(["", "deepseek chat", "-flash", "模型", "a".repeat(65), "x\"}"])("rejects %j", (model) => {
    expect(() => saveChatModel(model, createMemoryStorage())).toThrow();
  });

  it("falls back to the default when the saved name is unreadable", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:chat-model:v1", "bad name");
    expect(loadChatModel(storage)).toBe("deepseek-flash");
  });
});
