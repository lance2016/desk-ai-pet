import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { CHAT_INSTRUCTIONS_LIMIT, loadChatInstructions, saveChatInstructions } from "./ChatInstructions";
import { requestPreferences } from "./ChatPreferences";

describe("chat instructions", () => {
  it("keeps instructions per character and sends them with the request", () => {
    const storage = createMemoryStorage();
    saveChatInstructions("girl", "回答简短一些", storage);
    expect(requestPreferences("girl", undefined, storage).instructions).toBe("回答简短一些");
    expect(loadChatInstructions("cat", storage)).toBe("");
  });
  it("rejects overlong instructions without overwriting the saved value", () => {
    const storage = createMemoryStorage();
    saveChatInstructions("girl", "保留", storage);
    expect(() => saveChatInstructions("girl", "a".repeat(CHAT_INSTRUCTIONS_LIMIT + 1), storage)).toThrow();
    expect(loadChatInstructions("girl", storage)).toBe("保留");
  });
});
