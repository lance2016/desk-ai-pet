import { describe, expect, it } from "vitest";
import { CHARACTER_DATA, characterKey } from "../preferences/CharacterPreferences";
import { createMemoryStorage } from "../testing/fixtures";
import { CHAT_LIMITS, cleanTitle, clearThreads, keptEffects, loadAutoTitles, loadThreads, openingLine, recordThread, removeThread, retitleThread, saveAutoTitles, saveThreads, threadTitle, type ChatThread } from "./ChatThreads";
import { containsWebAddress, findWebAddresses, LINK_CONTEXT_BUDGET, webConversationStart } from "./ReadLinks";
import { loadReadLinks, saveReadLinks } from "../preferences/ReadLinkPreferences";

const PACK = "girl-default";
const threadsKey = characterKey(PACK, CHARACTER_DATA.chatThreads);
const legacyKey = characterKey(PACK, CHARACTER_DATA.chatHistory);
const user = (content: string) => ({ role: "user" as const, content });
const assistant = (content: string) => ({ role: "assistant" as const, content });

describe("threadTitle", () => {
  it("uses the first thing the user said, on one line and cut short", () => {
    expect(threadTitle([assistant("早上好"), user("  帮我\n记一下  ")])).toBe("帮我 记一下");
    expect(threadTitle([user("一".repeat(40))])).toBe(`${"一".repeat(CHAT_LIMITS.titleChars)}…`);
  });

  it("falls back to a generic title", () => {
    expect(threadTitle([])).toBe("新聊天");
  });
});

describe("recordThread", () => {
  it("adds a new thread first and keeps its title once set", () => {
    const first = recordThread([], "a", [user("你好")], 1);
    const second = recordThread(first, "b", [user("天气")], 2);
    expect(second.map((thread) => thread.id)).toEqual(["b", "a"]);
    const updated = recordThread(second, "a", [user("你好"), assistant("嗨"), user("改个话题")], 3);
    expect(updated[0]).toMatchObject({ id: "a", title: "你好", updatedAt: 3 });
    expect(updated[0].messages).toHaveLength(3);
  });

  it("drops empty threads, the oldest threads and the oldest messages", () => {
    expect(recordThread([], "a", [], 1)).toEqual([]);
    let threads: ChatThread[] = [];
    for (let index = 0; index <= CHAT_LIMITS.threads; index += 1) threads = recordThread(threads, `t${index}`, [user(`第 ${index} 段`)], index);
    expect(threads).toHaveLength(CHAT_LIMITS.threads);
    expect(threads.some((thread) => thread.id === "t0")).toBe(false);
    const long = Array.from({ length: CHAT_LIMITS.messages + 5 }, (_, index) => user(`消息 ${index}`));
    expect(recordThread([], "x", long, 1)[0].messages).toHaveLength(CHAT_LIMITS.messages);
  });

  it("does not change the input", () => {
    const threads = recordThread([], "a", [user("你好")], 1);
    const copy = structuredClone(threads);
    recordThread(threads, "a", [user("你好"), assistant("嗨")], 2);
    removeThread(threads, "a");
    expect(threads).toEqual(copy);
  });
});

describe("thread storage", () => {
  it("saves and loads threads", () => {
    const storage = createMemoryStorage();
    const threads = recordThread([], "a", [user("你好")], 1);
    saveThreads(PACK, threads, storage);
    expect(loadThreads(PACK, storage)).toEqual({ threads, valid: true });
  });

  it("turns the old single history into the first thread", () => {
    const storage = createMemoryStorage({ [legacyKey]: JSON.stringify([user("旧话题"), assistant("好呀")]) });
    const { threads, valid } = loadThreads(PACK, storage, 42);
    expect(valid).toBe(true);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ title: "旧话题", updatedAt: 42 });
    expect(storage.getItem(legacyKey)).toBeNull();
    expect(loadThreads(PACK, storage).threads).toEqual(threads);
  });

  it("keeps unreadable data untouched until it is cleared", () => {
    const storage = createMemoryStorage({ [threadsKey]: "not json", [legacyKey]: "[]" });
    expect(loadThreads(PACK, storage)).toEqual({ threads: [], valid: false });
    expect(storage.getItem(threadsKey)).toBe("not json");
    clearThreads(PACK, storage);
    expect(storage.getItem(threadsKey)).toBeNull();
    expect(storage.getItem(legacyKey)).toBeNull();
    expect(loadThreads(PACK, storage)).toEqual({ threads: [], valid: true });
  });

  it("round-trips the latest webpage snapshot and keeps sources for older replies", () => {
    const storage = createMemoryStorage();
    const open = { ...user("看 https://example.com"), readLink: "open" as const };
    const web = {
      sources: [{ url: "https://example.com", title: "Example" }],
      calls: "x".repeat(LINK_CONTEXT_BUDGET),
      incomplete: false,
      truncated: false,
    };
    const reply = { ...assistant("内容"), web };
    const threads = recordThread(recordThread([], "old", [open, reply], 1), "new", [open, reply], 2);
    saveThreads(PACK, threads, storage);
    const [newest, older] = loadThreads(PACK, storage).threads;
    expect(webConversationStart(newest.messages)).toBe(0);
    expect(newest.messages[1].web?.calls).toBe(web.calls);
    expect(webConversationStart(older.messages)).toBe(-1);
    expect(older.messages[1].web?.sources).toEqual(web.sources);
  });

  it("stores attachment information without persisting image bytes", () => {
    const storage = createMemoryStorage();
    const image = { id: "screenshot", name: "报错.png" };
    const message = { ...user("看看截图"), readLink: "image" as const, image, imageData: "data:image/png;base64,aGVsbG8=" };
    saveThreads(PACK, recordThread([], "image", [message], 1), storage);
    expect(loadThreads(PACK, storage).threads[0].messages).toEqual([{ ...user("看看截图"), readLink: "image", image }]);
    expect(storage.getItem(threadsKey)).not.toContain("data:image");
  });
});

describe("what a reply did", () => {
  it("keeps the lines for what the tools did with the reply, so the chat window shows them later", () => {
    const storage = createMemoryStorage();
    const effects = keptEffects([
      { kind: "agenda", id: "r1", text: "已设提醒：明早 9:00 开会", undo: () => {} },
      { kind: "agenda", id: "r2", text: "已删掉提醒：交周报" },
      { kind: "failed", text: "没能改提醒：找不到「买菜」" },
    ]);
    const reply = { ...assistant("都弄好了"), effects };
    saveThreads(PACK, recordThread([], "a", [user("帮我改提醒"), reply], 1), storage);
    expect(loadThreads(PACK, storage).threads[0].messages[1].effects).toEqual([
      { text: "已设提醒：明早 9:00 开会" },
      { text: "已删掉提醒：交周报" },
      { text: "没能改提醒：找不到「买菜」", failed: true },
    ]);
  });

  it("leaves a reply that did nothing as it was, and reads replies saved before lines were kept", () => {
    expect(keptEffects([])).toBeUndefined();
    const storage = createMemoryStorage({ [threadsKey]: JSON.stringify([{ id: "a", title: "旧", updatedAt: 1, messages: [user("旧"), assistant("好")] }]) });
    expect(loadThreads(PACK, storage)).toMatchObject({ valid: true, threads: [{ messages: [user("旧"), assistant("好")] }] });
  });

  it("stays within what the store accepts, so a long line never stops the reply from being kept", () => {
    const many = Array.from({ length: CHAT_LIMITS.effects + 5 }, (_, index) => ({ kind: "note" as const, text: `已存进备忘：${"长".repeat(1000)}${index}` }));
    const effects = keptEffects(many) ?? [];
    expect(effects).toHaveLength(CHAT_LIMITS.effects);
    const storage = createMemoryStorage();
    saveThreads(PACK, recordThread([], "a", [user("存"), { ...assistant("好"), effects }], 1), storage);
    expect(loadThreads(PACK, storage).valid).toBe(true);
  });
});

describe("a thread the pet opened", () => {
  const opened = [{ role: "assistant" as const, content: "已经很晚啦", unprompted: true as const }, user("马上就睡")];

  it("knows the line the pet said by itself", () => {
    expect(openingLine(opened)).toBe("已经很晚啦");
  });

  it("does not take an ordinary reply for one, even when it comes first", () => {
    expect(openingLine([assistant("回复"), user("好")])).toBeNull();
    expect(openingLine([user("在吗"), assistant("在")])).toBeNull();
    expect(openingLine([])).toBeNull();
  });

  it("names the thread after the user's answer, also when the pet's line was kept first", () => {
    const waiting = recordThread([], "a", opened.slice(0, 1), 1);
    expect(waiting[0].title).toBe("新聊天");
    expect(recordThread(waiting, "a", opened, 2)[0].title).toBe("马上就睡");
  });

  it("tidies the title after the first real reply, as in any other thread", () => {
    const asked = recordThread([], "a", [opened[0], user("标题：周报怎么写？")], 1);
    const replied = recordThread(asked, "a", [opened[0], user("标题：周报怎么写？"), assistant("这样写")], 2);
    expect(replied[0].title).toBe("周报怎么写");
  });

  it("keeps the mark when saved and loaded", () => {
    const storage = createMemoryStorage();
    saveThreads(PACK, recordThread([], "a", opened, 1), storage);
    const { threads, valid } = loadThreads(PACK, storage);
    expect(valid).toBe(true);
    expect(openingLine(threads[0].messages)).toBe("已经很晚啦");
    expect(threads[0].title).toBe("马上就睡");
  });
});

describe("reading links", () => {
  it("defaults to automatic reading and keeps the user's setting", () => {
    const storage = createMemoryStorage();
    expect(loadReadLinks(storage)).toBe(true);
    saveReadLinks(false, storage);
    expect(loadReadLinks(storage)).toBe(false);
    saveReadLinks(true, storage);
    expect(loadReadLinks(storage)).toBe(true);
  });

  it("finds URLs in Chinese text and rejects non-web URLs", () => {
    expect(containsWebAddress("帮我看（https://example.com/docs）。")).toBe(true);
    expect(containsWebAddress("file:///tmp/test.html")).toBe(false);
    expect(containsWebAddress("https://secret:password@example.com")).toBe(false);
  });

  it("keeps punctuation outside clickable URLs and preserves URL parentheses", () => {
    const text = "参考 (https://example.com/wiki/Topic_(part)).";
    const [link] = findWebAddresses(text);
    expect(text.slice(0, link.start)).toBe("参考 (");
    expect(link.url.href).toBe("https://example.com/wiki/Topic_(part)");
    expect(text.slice(link.start + link.text.length)).toBe(").");
  });

  it("continues a webpage conversation until the user returns to regular chat", () => {
    const open = { ...user("看 https://example.com"), readLink: "open" as const };
    const follow = { ...user("第二节呢"), readLink: "follow" as const };
    const web = { sources: [], calls: "[]", incomplete: false, truncated: false };
    const replies = [open, { ...assistant("摘要"), web }, follow];
    expect(webConversationStart(replies)).toBe(0);
    expect(webConversationStart([...replies, user("敲个木鱼")])).toBe(-1);
    expect(webConversationStart([open])).toBe(-1);
  });
});

describe("generated titles", () => {
  it("cleans a model's title down to one short line", () => {
    expect(cleanTitle(" “周末去哪玩。” \n")).toBe("周末去哪玩");
    expect(cleanTitle("标题：周末计划")).toBe("周末计划");
    expect(cleanTitle("一".repeat(30))).toBe(`${"一".repeat(CHAT_LIMITS.titleChars)}…`);
    expect(cleanTitle(" 。 ")).toBe("");
  });

  it("renames a thread in place without moving it", () => {
    const threads = recordThread(recordThread([], "a", [user("你好")], 1), "b", [user("天气")], 2);
    const renamed = retitleThread(threads, "a", "打个招呼");
    expect(renamed.map((thread) => [thread.id, thread.title, thread.updatedAt])).toEqual([["b", "天气", 2], ["a", "打个招呼", 1]]);
    expect(retitleThread(threads, "missing", "x")).toEqual(threads);
    expect(retitleThread(threads, "a", "  ")).toEqual(threads);
    // A later message keeps the generated title.
    expect(recordThread(renamed, "a", [user("你好"), assistant("嗨")], 3)[0].title).toBe("打个招呼");
  });

  it("generates titles unless the user turned it off", () => {
    const storage = createMemoryStorage();
    expect(loadAutoTitles(storage)).toBe(true);
    saveAutoTitles(false, storage);
    expect(loadAutoTitles(storage)).toBe(false);
  });
});
