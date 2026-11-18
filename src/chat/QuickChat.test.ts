import { describe, expect, it } from "vitest";
import type { ChatThread } from "./ChatThreads";
import { CHAT_LIMITS, contextMessages } from "./ChatThreads";
import { QUICK_CHAT_CONFIG, pickQuickThread, plainReply, quickHistory, replyLingerMs } from "./QuickChat";

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
