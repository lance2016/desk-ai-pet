import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAgendaItem, loadAgenda, updateAgenda } from "../agenda/AgendaStore";
import { loadNotes, saveNote } from "../notes/NoteStore";
import type { StreamEvent } from "../platform/llm";
import { CHAT_SKILLS } from "../skills";
import { chatPreferences, chatRequestContext, createMemoryStorage } from "../testing/fixtures";
import type { ActionResult } from "../types";
import { READ_TOOL, SEARCH_TOOL } from "./deepseek/web";
import { ai } from "./index";
import type { RequestBody } from "./requests";
import type { ChatEvent } from "./types";

const platform = vi.hoisted(() => {
  let handler: ((event: StreamEvent) => void) | null = null;
  return {
    send: (event: StreamEvent) => handler?.(event),
    llmPlatform: {
      subscribe: async (next: (event: StreamEvent) => void) => { handler = next; return () => {}; },
      stream: vi.fn(async (_provider: string, _id: string, _body: object) => {}),
      cancel: vi.fn(async (_id: string) => {}),
      windowLabel: () => "chat",
      putLogEntry: vi.fn(async (_entry: object) => {}),
      addStat: vi.fn(async (_stat: object) => {}),
    },
    requestChatAction: vi.fn(async (id: string, _requestId: string): Promise<ActionResult> => ({ accepted: true, actionId: id })),
  };
});
vi.mock("../platform/llm", () => ({ llmPlatform: platform.llmPlatform }));
vi.mock("../platform/petWindow", () => ({ petWindow: { requestChatAction: platform.requestChatAction } }));

const NOW = new Date(2026, 10, 18, 14, 0).getTime();
const ACTIONS = ["wooden_fish", "happy", "wave"];
const FINAL: ReadonlySet<string> = new Set(["done", "error", "cancelled", "web-error"]);
type End = { status: number | null; ok: boolean; cancelled: boolean };
const OK: End = { status: 200, ok: true, cancelled: false };
let counter = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("window", { localStorage: createMemoryStorage() });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  platform.llmPlatform.stream.mockClear();
  platform.requestChatAction.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const chunk = (content: string | null, toolCalls: unknown[] = [], finish: string | null = null) =>
  ({ choices: [{ delta: { content, tool_calls: toolCalls }, finish_reason: finish }] });
const call = (index: number, name: string | undefined, args: string) => ({ index, id: name ? `call_${index}_${name}` : undefined, function: { ...(name ? { name } : {}), arguments: args } });

/** Feeds one round of a reply in: its packets, the end of the stream and the end of the request. */
function feed(id: string, packets: readonly object[], end: End = OK) {
  for (const packet of packets) platform.send({ id, kind: "data", data: JSON.stringify(packet) });
  platform.send({ id, kind: "data", data: "[DONE]" });
  platform.send({ id, kind: "end", ...end });
}

/** The request body of the `round`-th request made so far (1 is the first). */
const sent = (round: number) => platform.llmPlatform.stream.mock.calls[round - 1][2] as RequestBody;
const rounds = () => platform.llmPlatform.stream.mock.calls.length;

/** Starts a reply, lets `play` drive it, and returns every event the window got for it. */
async function run(start: (id: string) => Promise<void>, play: (id: string) => Promise<void> | void): Promise<ChatEvent[]> {
  const id = `r${++counter}`;
  const events: ChatEvent[] = [];
  const stop = await ai.subscribe((event) => { if (event.id === id) events.push(event); });
  await start(id);
  await play(id);
  await vi.waitFor(() => expect(events.some((event) => FINAL.has(event.kind))).toBe(true));
  stop();
  return events;
}

/** Feeds the rounds one after another, each once its request was sent. */
const multi = (...replies: ReadonlyArray<readonly object[]>) => async (id: string) => {
  for (const [index, packets] of replies.entries()) {
    await vi.waitFor(() => expect(rounds()).toBe(index + 1));
    feed(id, packets);
  }
};

const chat = (text: string, toolsOff?: readonly string[]) => (id: string) => ai.start(id, [{ role: "user", content: text }], chatPreferences(), { context: chatRequestContext({ actions: ACTIONS, toolsOff }), skills: CHAT_SKILLS });
const reply = (text: string, packets: readonly object[], end: End = OK) => run(chat(text), (id) => feed(id, packets, end));
const pairs = (events: readonly ChatEvent[]) => events.map((event) => (event.kind === "effect" ? ["effect", event.line.text] : [event.kind, event.text]));

describe("chat replies", () => {
  it("plays an action as soon as its arguments are complete, only once", async () => {
    const events = await run(chat("敲个木鱼"), async (id) => {
      const args = `{"action":"wooden_fish"}`;
      for (const packet of [chunk("来，", [call(0, "play_action", `{"action"`)]), chunk("这就来。"), chunk(null, [call(0, undefined, args.slice(`{"action"`.length))])]) {
        platform.send({ id, kind: "data", data: JSON.stringify(packet) });
      }
      await vi.waitFor(() => expect(platform.requestChatAction).toHaveBeenCalledExactlyOnceWith("wooden_fish", id));
      feed(id, [chunk("看好啦。", [call(1, "play_action", args)], "tool_calls")]);
    });
    expect(pairs(events)).toEqual([["delta", "来，"], ["delta", "这就来。"], ["delta", "看好啦。"], ["done", ""]]);
    expect(platform.requestChatAction).toHaveBeenCalledTimes(1);
    expect(rounds()).toBe(1);
  });

  it("answers ordinary messages with text alone", async () => {
    expect(pairs(await reply("hi", [chunk("嗨。", [], "stop")]))).toEqual([["delta", "嗨。"], ["done", ""]]);
  });

  it("never plays a cut, unknown or padded action, or one written into the text", async () => {
    for (const args of [`{"action":"wooden_fish"`, `{"action":"unknown"}`, `{"action":"wave","extra":true}`]) {
      expect(pairs(await reply("敲个木鱼", [chunk(null, [call(0, "play_action", args)], "tool_calls")])))
        .toEqual([["effect", "这个动作现在播不了。"], ["delta", "这个动作现在播不了。"], ["done", ""]]);
    }
    expect(platform.requestChatAction).not.toHaveBeenCalled();
    expect(pairs(await reply("讨论", [chunk("可以讨论。 play_action(action=wave)", [], "stop")]))).toEqual([["delta", "可以讨论。"], ["done", ""]]);
    expect(pairs(await reply("敲个木鱼", [chunk(null, [call(0, "play_action", `{"action":"wooden_fish"}`)], "tool_calls")]))).toEqual([["delta", "好，来吧。"], ["done", ""]]);
  });

  it("says when the pet is busy, without claiming that it played", async () => {
    platform.requestChatAction.mockResolvedValueOnce({ accepted: false, reason: "busy" });
    expect(pairs(await reply("挥挥手", [chunk(null, [call(0, "play_action", `{"action":"wave"}`)], "tool_calls")])))
      .toEqual([["effect", "宠物现在正忙，暂时做不了这个动作。"], ["delta", "宠物现在正忙，暂时做不了这个动作。"], ["done", ""]]);
  });

  it("sets a reminder and says so when the model only called the tool", async () => {
    const events = await reply("明天九点提醒我开会", [chunk(null, [call(0, "add_reminder", `{"text":"开会","remind_at":"2026-11-19 09:00"}`), call(9, "save_note", "{}")], "tool_calls")]);
    expect(loadAgenda()).toMatchObject([{ text: "开会", remindAt: new Date(2026, 10, 19, 9).getTime() }]);
    expect(pairs(events)).toEqual([
      ["effect", "已设提醒：明天 09:00 · 开会"],
      ["effect", "一次最多处理 8 件，后面 1 件没做"],
      ["delta", "好，明天 09:00 提醒你：开会。有的没做成，看下面的说明"],
      ["done", ""],
    ]);
    expect(rounds()).toBe(1);
  });

  it("shows a looked-up list as it is, without another request", async () => {
    saveNote("WiFi 密码 abc123");
    const events = await reply("我记了什么", [chunk("给你看。", [call(0, "list_notes", "{}")], "tool_calls")]);
    expect(pairs(events)).toEqual([["delta", "给你看。"], ["delta", "\n\n你的备忘：\n1. WiFi 密码 abc123"], ["done", ""]]);
    expect(rounds()).toBe(1);
  });

  it("looks a reminder up and changes it in one message, and the change can be undone", async () => {
    updateAgenda((items) => addAgendaItem(items, { id: "meeting", text: "开会", remindAt: new Date(2026, 10, 18, 15).getTime() }, NOW));
    const events = await run(chat("把三点的会改到四点"), multi(
      [chunk(null, [call(0, "list_reminders", `{"synthesize":true}`)], "tool_calls")],
      [chunk("改好啦。", [call(0, "update_reminder", `{"ref":"r1","remind_at":"2026-11-18 16:00"}`)], "tool_calls")],
    ));
    const second = sent(2);
    expect(second.messages.slice(-2)).toMatchObject([
      { role: "assistant", tool_calls: [{ id: "call_0_list_reminders", function: { name: "list_reminders" } }] },
      { role: "tool", tool_call_id: "call_0_list_reminders", content: expect.stringContaining("r1. 今天 15:00 开会") },
    ]);
    expect(second.tools).toBeDefined();
    expect(loadAgenda()[0].remindAt).toBe(new Date(2026, 10, 18, 16).getTime());
    expect(pairs(events)).toEqual([["delta", "改好啦。"], ["effect", "已改提醒：今天 16:00 · 开会"], ["done", ""]]);
    const line = events.find((event) => event.kind === "effect");
    if (line?.kind === "effect") line.line.undo?.();
    expect(loadAgenda()[0].remindAt).toBe(new Date(2026, 10, 18, 15).getTime());
    expect(rounds()).toBe(2);
  });

  it("deletes a note it looked up, and puts it back on undo", async () => {
    saveNote("买牛奶");
    saveNote("WiFi 密码 abc123");
    const events = await run(chat("把牛奶那条删了"), multi(
      [chunk(null, [call(0, "list_notes", `{"synthesize":true}`)], "tool_calls")],
      [chunk(null, [call(0, "delete_note", `{"ref":"n2"}`)], "tool_calls")],
    ));
    expect(loadNotes().map((note) => note.text)).toEqual(["WiFi 密码 abc123"]);
    expect(pairs(events)).toEqual([["effect", "已删除备忘：买牛奶"], ["delta", "好，删掉了这条备忘"], ["done", ""]]);
    const line = events.find((event) => event.kind === "effect");
    if (line?.kind === "effect") line.line.undo?.();
    expect(loadNotes().map((note) => note.text).sort()).toEqual(["WiFi 密码 abc123", "买牛奶"]);
  });

  it("does not run a tool the user turned off, even when the model calls it", async () => {
    saveNote("买牛奶");
    const events = await run(chat("把牛奶那条删了", ["delete_note"]), multi(
      [chunk(null, [call(0, "list_notes", `{"synthesize":true}`)], "tool_calls")],
      [chunk(null, [call(0, "delete_note", `{"ref":"n1"}`)], "tool_calls")],
    ));
    expect(loadNotes().map((note) => note.text)).toEqual(["买牛奶"]);
    expect(JSON.stringify(sent(1).tools)).not.toContain("delete_note");
    expect(pairs(events)).toEqual([["effect", "「删除备忘」在设置里关着，没有做"], ["delta", "「删除备忘」在设置里关着，没有做"], ["done", ""]]);
  });

  it("lets the model look up first when it names an item it has not listed", async () => {
    const events = await run(chat("删掉开会那条"), multi(
      [chunk(null, [call(0, "delete_reminder", `{"ref":"r1"}`)], "tool_calls")],
      [chunk("你现在没有提醒。", [], "stop")],
    ));
    expect(String(sent(2).messages[sent(2).messages.length - 1].content)).toContain("先用 list_reminders 查一下");
    expect(pairs(events)).toEqual([["effect", "没改成：找不到编号 r1 的提醒，先用 list_reminders 查一下"], ["delta", "你现在没有提醒。"], ["done", ""]]);
  });

  it("stops after four requests, the last one without further calls", async () => {
    const lookup = [chunk(null, [call(0, "list_notes", `{"synthesize":true}`)], "tool_calls")];
    const events = await run(chat("一直查"), multi(lookup, lookup, lookup, [chunk("查完了。", [], "stop")]));
    expect(rounds()).toBe(4);
    expect(sent(3).tool_choice).toBeUndefined();
    expect(sent(4).tool_choice).toBe("none");
    expect(pairs(events)).toEqual([["delta", "查完了。"], ["done", ""]]);
  });

  it("keeps what it did when a later request fails", async () => {
    saveNote("WiFi 密码 abc123");
    const events = await run(chat("WiFi 密码是多少"), async (id) => {
      feed(id, [chunk("我查查。", [call(0, "list_notes", `{"synthesize":true}`)], "tool_calls")]);
      await vi.waitFor(() => expect(rounds()).toBe(2));
      feed(id, [], { status: 500, ok: false, cancelled: false });
    });
    expect(pairs(events)).toEqual([["delta", "我查查。"], ["delta", "\n\n查到了记录，但暂时没法接着处理。可以再说一次，或者在提醒、备忘面板里操作。"], ["done", ""]]);
  });

  it("tells failures apart by status", async () => {
    expect(pairs(await reply("hi", [], { status: 401, ok: false, cancelled: false }))).toEqual([["error", "API Key 无效，请在设置中检查。"]]);
    expect(pairs(await reply("hi", [], { status: null, ok: false, cancelled: false }))).toEqual([["error", "连接或回复中断，请检查网络后重试。"]]);
    // A reply that broke off after a good start is an interruption, not a status problem.
    expect(pairs(await run(chat("hi"), (id) => { platform.send({ id, kind: "data", data: JSON.stringify(chunk("半句")) }); platform.send({ id, kind: "end", status: 200, ok: false, cancelled: false }); }))).toEqual([["delta", "半句"], ["error", "连接或回复中断，请检查网络后重试。"]]);
    expect(pairs(await reply("hi", [chunk(null, [], "content_filter")]))).toEqual([["error", "这条内容未能通过 DeepSeek 的审核。"]]);
  });

  it("answers one message at a time and stops on request", async () => {
    const events = await run(chat("讲个长故事"), async (id) => {
      platform.send({ id, kind: "data", data: JSON.stringify(chunk("从前")) });
      await expect(chat("又一句")("other")).rejects.toThrow("还在回复");
      await ai.cancel(id);
      platform.send({ id, kind: "data", data: JSON.stringify(chunk("有座山")) });
      platform.send({ id, kind: "end", status: null, ok: false, cancelled: true });
    });
    expect(pairs(events)).toEqual([["delta", "从前"], ["cancelled", ""]]);
    expect(platform.llmPlatform.cancel).toHaveBeenCalled();
  });

  it("still reports an action that started before the reply was stopped", async () => {
    platform.requestChatAction.mockResolvedValueOnce({ accepted: false, reason: "cooldown" });
    const events = await run(chat("挥挥手"), async (id) => {
      platform.send({ id, kind: "data", data: JSON.stringify(chunk(null, [call(0, "play_action", `{"action":"wave"}`)])) });
      await vi.waitFor(() => expect(platform.requestChatAction).toHaveBeenCalled());
      await ai.cancel(id);
      platform.send({ id, kind: "end", status: null, ok: false, cancelled: true });
    });
    expect(pairs(events)).toEqual([["effect", "这个动作刚做过，等一下再试。"], ["cancelled", ""]]);
  });

  it("gives the message back when the request cannot start", async () => {
    platform.llmPlatform.stream.mockRejectedValueOnce("API key is not configured");
    await expect(chat("hi")("never")).rejects.toBe("API key is not configured");
    expect(pairs(await reply("hi", [chunk("在。", [], "stop")]))).toEqual([["delta", "在。"], ["done", ""]]);
  });

  it("records each request in developer mode, without picture bytes", async () => {
    platform.llmPlatform.putLogEntry.mockClear();
    const usage = { prompt_tokens: 900, completion_tokens: 12, total_tokens: 912, prompt_cache_hit_tokens: 640, prompt_cache_miss_tokens: 260 };
    await run((id) => ai.start(id, [{ role: "user", content: "看图", imageData: "data:image/png;base64,aGVsbG8=" }], chatPreferences({ record: true }), { mode: "image" }), (id) => feed(id, [chunk("是只猫。", [], "stop"), { choices: [], usage }]));
    const logged = platform.llmPlatform.putLogEntry.mock.calls;
    const entry = logged[logged.length - 1][0] as { window: string; rounds: Array<{ request: unknown; reply: string; ok: boolean }> };
    expect(entry.window).toBe("chat");
    expect(entry.rounds).toHaveLength(1);
    expect(entry.rounds[0]).toMatchObject({ reply: "是只猫。", ok: true, durationMs: expect.any(Number), firstTokenMs: expect.any(Number), usage: { promptTokens: 900, completionTokens: 12, cacheHitTokens: 640 } });
    expect(JSON.stringify(entry.rounds[0].request)).toContain("[Image omitted]");
    expect(JSON.stringify(entry.rounds[0].request)).not.toContain("aGVsbG8=");
  });
});

describe("request records", () => {
  it("leaves a short row for every request, without content, also outside developer mode", async () => {
    platform.llmPlatform.addStat.mockClear();
    platform.llmPlatform.putLogEntry.mockClear();
    await run((id) => ai.translate(id, "hello", "zh", "deepseek-chat"), (id) => feed(id, [chunk("你好", [], "stop"), { choices: [], usage: { prompt_tokens: 30, completion_tokens: 2 } }]));
    expect(platform.llmPlatform.putLogEntry).not.toHaveBeenCalled();
    expect(platform.llmPlatform.addStat).toHaveBeenCalledWith(expect.objectContaining({
      kind: "text", window: "chat", model: "deepseek-chat", ok: true, status: 200,
      durationMs: expect.any(Number), firstTokenMs: expect.any(Number), promptTokens: 30, completionTokens: 2, cacheHitTokens: null,
    }));
    expect(JSON.stringify(platform.llmPlatform.addStat.mock.calls)).not.toContain("hello");
  });
});

describe("webpage replies", () => {
  const readCall = { index: 0, id: "srvtoolu_test", type: READ_TOOL, kind: "read_link", status: "completed", page: { url: "https://example.com", title: "Example" }, signature: "opaque" };
  const open = (text: string) => (id: string) => ai.start(id, [{ role: "user", content: text, readLink: "open" }], chatPreferences(), { mode: "open" });

  it("reports progress and sources without playing local tools", async () => {
    const events = await run(open("请总结 https://example.com"), (id) => feed(id, [
      { choices: [{ delta: {}, server_tool_event: { type: "call_started", call: { type: READ_TOOL } } }] },
      { choices: [{ delta: { content: "网页摘要", tool_calls: [call(0, "play_action", `{"action":"wooden_fish"}`)] }, server_tool_event: { type: "call_completed", call: readCall } }] },
      { choices: [{ delta: { server_tool_calls: [{ index: 0, calls: [readCall] }], annotations: [{ type: "url_citation", url_citation: { url: "https://example.com", title: "Example" } }] }, finish_reason: "stop" }] },
    ]));
    expect(pairs(events).slice(0, 3)).toEqual([["web-progress", "reading"], ["delta", "网页摘要"], ["web-progress", "read"]]);
    const result = events.find((event) => event.kind === "web-result");
    expect(JSON.parse(result?.kind === "web-result" ? result.text : "{}")).toMatchObject({ sources: [{ url: "https://example.com", title: "Example" }], incomplete: false, truncated: false, calls: expect.any(String) });
    expect(events[events.length - 1].kind).toBe("done");
    expect(platform.requestChatAction).not.toHaveBeenCalled();
  });

  it("explains a page it could not read, and a search that found nothing", async () => {
    const failed = await run(open("https://example.com"), (id) => feed(id, [
      { choices: [{ delta: {}, server_tool_event: { type: "call_completed", call: { type: READ_TOOL, status: "failed" } } }] },
      { choices: [{ delta: { content: "读不到" }, finish_reason: "stop" }] },
    ]));
    expect(pairs(failed)[failed.length - 1]).toEqual(["web-error", "没能读取网页，请检查链接是否能直接打开，或复制正文到聊天里。"]);
    const searched = await run((id) => ai.start(id, [{ role: "user", content: "最新消息", readLink: "search" }], chatPreferences(), { mode: "search" }), (id) => feed(id, [
      { choices: [{ delta: {}, server_tool_event: { type: "call_started", call: { type: SEARCH_TOOL } } }] },
      { choices: [{ delta: { content: "没找到" }, finish_reason: "stop" }] },
    ]));
    expect(pairs(searched)).toEqual([["web-progress", "searching"], ["delta", "没找到"], ["web-error", "没找到可引用的网页，试着换个问法再搜。"]]);
  });

  it("refuses as a webpage error", async () => {
    expect(pairs(await run(open("https://example.com"), (id) => feed(id, [chunk(null, [], "content_filter")])))).toEqual([["web-error", "这条内容未能通过 DeepSeek 的审核。"]]);
  });
});

describe("text tasks", () => {
  it("streams the result without tools", async () => {
    const events = await run((id) => ai.translate(id, "hello", "zh", "deepseek-flash"), (id) => feed(id, [chunk("你好", [], "stop")]));
    expect(pairs(events)).toEqual([["delta", "你好"], ["done", ""]]);
    expect(sent(1).tools).toBeUndefined();
  });
});
