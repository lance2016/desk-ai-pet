import { describe, expect, it } from "vitest";
import type { ChatThread } from "./ChatThreads";
import { CHAT_LIMITS, contextMessages } from "./ChatThreads";
import { createMemoryStorage } from "../testing/fixtures";
import { QUICK_CHAT_CONFIG, answerable, clearReplying, markReplying, pickQuickThread, plainReply, quickHistory, replyingThread, replyLingerMs, touchesReplying, withoutLastLine } from "./QuickChat";

const NOW = Date.UTC(2026, 10, 16, 9, 0);
const thread = (id: string, updatedAt: number, messages: ChatThread["messages"] = [{ role: "user", content: "hi" }]): ChatThread => ({ id, title: id, updatedAt, messages });

describe("pickQuickThread", () => {
  it("starts a new thread for the first line after the bar opens, however recent the latest thread is", () => {
    expect(pickQuickThread([thread("a", NOW - 1_000)], null)).toBeNull();
    expect(pickQuickThread([], null)).toBeNull();
  });

  it("continues the thread this opening of the bar already wrote to", () => {
    const threads = [thread("a", NOW - 1_000), thread("b", NOW - 60_000)];
    expect(pickQuickThread(threads, "b")?.id).toBe("b");
  });

  it("starts fresh when that thread was deleted meanwhile", () => {
    expect(pickQuickThread([thread("a", NOW)], "gone")).toBeNull();
  });
});

describe("answering the pet", () => {
  const spoken = { text: "回来啦，欢迎回来～", at: NOW };

  it("takes a line the pet just said as what the user answers", () => {
    expect(answerable(spoken, NOW + 1_000)).toBe("回来啦，欢迎回来～");
    expect(answerable(spoken, NOW + QUICK_CHAT_CONFIG.answerWindowMs - 1)).toBe("回来啦，欢迎回来～");
  });

  it("lets it go once the window has passed, or when the pet said nothing", () => {
    expect(answerable(spoken, NOW + QUICK_CHAT_CONFIG.answerWindowMs)).toBeNull();
    expect(answerable(null, NOW)).toBeNull();
  });

  it("opens a new thread with the pet's line, marked as said by itself", () => {
    expect(quickHistory(null, "嗯，刚开完会", "回来啦，欢迎回来～")).toEqual([
      { role: "assistant", content: "回来啦，欢迎回来～", unprompted: true },
      { role: "user", content: "嗯，刚开完会" },
    ]);
  });

  it("does not add the line again to a thread that is already going", () => {
    expect(quickHistory(thread("a", NOW), "在吗", "回来啦，欢迎回来～")).toEqual([{ role: "user", content: "hi" }, { role: "user", content: "在吗" }]);
  });

  it("sends the user's answer without the pet's line in front: that goes into the prompt", () => {
    expect(contextMessages(quickHistory(null, "嗯", "回来啦"))).toEqual([{ role: "user", content: "嗯" }]);
  });
});

describe("withoutLastLine", () => {
  it("takes the unanswered line back out", () => {
    expect(withoutLastLine([{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }])).toEqual([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]);
  });

  it("leaves nothing when only the pet's own line would remain", () => {
    expect(withoutLastLine([{ role: "assistant", content: "回来啦", unprompted: true }, { role: "user", content: "嗯" }])).toEqual([]);
    expect(withoutLastLine([{ role: "user", content: "嗯" }])).toEqual([]);
  });
});

describe("quickHistory", () => {
  it("appends the new line to the thread", () => {
    expect(quickHistory(thread("a", NOW), "在吗")).toEqual([{ role: "user", content: "hi" }, { role: "user", content: "在吗" }]);
    expect(quickHistory(null, "在吗")).toEqual([{ role: "user", content: "在吗" }]);
  });

  it("keeps the newest messages, and sends only the latest as context, never starting with a reply", () => {
    const long = Array.from({ length: CHAT_LIMITS.messages }, (_, index) => ({ role: index % 2 === 0 ? "user" as const : "assistant" as const, content: `m${index}` }));
    const history = quickHistory(thread("a", NOW, long), "new");
    expect(history).toHaveLength(CHAT_LIMITS.messages);
    expect(history[history.length - 1]).toEqual({ role: "user", content: "new" });
    const context = contextMessages(history);
    expect(context.length).toBeLessThanOrEqual(CHAT_LIMITS.context);
    expect(context[0].role).toBe("user");
    expect(context[context.length - 1]).toEqual({ role: "user", content: "new" });
  });
});

describe("plainReply", () => {
  it("drops Markdown marks and joins blocks on one line", () => {
    expect(plainReply("# 计划\n**先**休息\n\n- 喝水\n- 走走")).toBe("计划 先休息 · 喝水 · 走走");
  });
});

describe("replyLingerMs", () => {
  it("gives longer replies more reading time within bounds", () => {
    expect(replyLingerMs("好")).toBe(QUICK_CHAT_CONFIG.lingerMinMs);
    expect(replyLingerMs("字".repeat(1000))).toBe(QUICK_CHAT_CONFIG.lingerMaxMs);
    expect(replyLingerMs("字".repeat(60))).toBeGreaterThan(replyLingerMs("字".repeat(30)));
  });
});

describe("a reply on its way in the pet window", () => {
  it("tells the chat window which thread is being answered, until it is over", () => {
    const storage = createMemoryStorage();
    expect(replyingThread(storage, NOW)).toBeNull();
    markReplying("t1", storage, NOW);
    expect(replyingThread(storage, NOW + 1_000)).toBe("t1");
    clearReplying("t1", storage);
    expect(replyingThread(storage, NOW + 2_000)).toBeNull();
  });

  it("forgets a mark left behind, so the chat window does not wait forever after the pet window went away", () => {
    const storage = createMemoryStorage();
    markReplying("t1", storage, NOW);
    expect(replyingThread(storage, NOW + QUICK_CHAT_CONFIG.replyingStaleMs + 1)).toBeNull();
    storage.setItem("ai-pet:chat-replying:v1", "not json");
    expect(replyingThread(storage, NOW)).toBeNull();
  });

  it("only lets the reply that set the mark take it down", () => {
    const storage = createMemoryStorage();
    markReplying("t2", storage, NOW);
    clearReplying("t1", storage);
    expect(replyingThread(storage, NOW)).toBe("t2");
    clearReplying("t2", storage);
    expect(replyingThread(storage, NOW)).toBeNull();
  });

  it("names the storage key the chat window listens for", () => {
    expect(touchesReplying("ai-pet:chat-replying:v1")).toBe(true);
    expect(touchesReplying(null)).toBe(true);
    expect(touchesReplying("ai-pet:agenda:v1")).toBe(false);
  });
});
