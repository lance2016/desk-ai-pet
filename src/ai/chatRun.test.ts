import { describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "../platform/llm";
import { chatPreferences, chatRequestContext } from "../testing/fixtures";
import { READ_TOOL, SEARCH_TOOL } from "./deepseek/web";
import { ai } from "./index";
import type { ChatEvent } from "./types";

const platform = vi.hoisted(() => {
  let handler: ((event: StreamEvent) => void) | null = null;
  return {
    send: (event: StreamEvent) => handler?.(event),
    llmPlatform: {
      subscribe: vi.fn(async (next: (event: StreamEvent) => void) => { handler = next; return () => {}; }),
      stream: vi.fn(async (_provider: string, _id: string, _body: object) => {}),
      cancel: vi.fn(async (_id: string) => {}),
      windowLabel: () => "chat",
      putLogEntry: vi.fn(async (_entry: object) => {}),
    },
  };
});
vi.mock("../platform/llm", () => ({ llmPlatform: platform.llmPlatform }));

const ACTIONS = ["wooden_fish", "happy", "wave"];
const FINAL: ReadonlySet<string> = new Set(["done", "error", "cancelled", "web-error"]);
type End = { status: number | null; ok: boolean; cancelled: boolean };
const OK: End = { status: 200, ok: true, cancelled: false };
let counter = 0;

const chunk = (content: string | null, toolCalls: unknown[] = [], finish: string | null = null) =>
  ({ choices: [{ delta: { content, tool_calls: toolCalls }, finish_reason: finish }] });
const call = (index: number, name: string | undefined, args: string) => ({ index, function: { ...(name ? { name } : {}), arguments: args } });

/** Feeds one round of a reply in: its packets, the end of the stream and the end of the request. */
function feed(id: string, packets: readonly object[], end: End = OK) {
  for (const packet of packets) platform.send({ id, kind: "data", data: JSON.stringify(packet) });
  platform.send({ id, kind: "data", data: "[DONE]" });
  platform.send({ id, kind: "end", ...end });
}

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

const chat = (text: string, overrides = {}) => (id: string) => ai.start(id, [{ role: "user", content: text }], chatPreferences(overrides), chatRequestContext({ actions: ACTIONS, notes: ["WiFi 密码 abc123"] }));
const reply = (text: string, packets: readonly object[], end: End = OK) => run(chat(text), (id) => feed(id, packets, end));
const pairs = (events: readonly ChatEvent[]) => events.map(({ kind, text }) => [kind, text]);

describe("chat replies", () => {
  it("streams text and a complete action independently, only once", async () => {
    for (const action of ["wooden_fish", "happy", "wave"]) {
      const args = `{"action":"${action}"}`;
      const events = await reply("做个动作", [
        chunk("来，", [call(0, "play_action", `{"action"`)]),
        chunk("这就来。"),
        chunk(null, [call(0, undefined, args.slice(`{"action"`.length))]),
        chunk("看好啦。", [call(1, "play_action", args)], "tool_calls"),
      ]);
      expect(pairs(events)).toEqual([["delta", "来，"], ["delta", "这就来。"], ["action", action], ["delta", "看好啦。"], ["done", ""]]);
    }
  });

  it("answers ordinary messages with text alone", async () => {
    for (const text of ["嗨。", "累了就先歇会儿。"]) {
      expect(pairs(await reply("hi", [chunk(text, [], "stop")]))).toEqual([["delta", text], ["done", ""]]);
    }
  });

  it("never plays a cut, unknown or padded action, or one written into the text", async () => {
    for (const args of [`{"action":"wooden_fish"`, `{"action":"unknown"}`, `{"action":"wave","extra":true}`]) {
      expect(pairs(await reply("敲个木鱼", [chunk(null, [call(0, "play_action", args)], "tool_calls")]))).toEqual([["action", ""], ["done", ""]]);
    }
    expect(pairs(await reply("讨论", [chunk("可以讨论。 play_action(action=wave)", [], "stop")]))).toEqual([["delta", "可以讨论。"], ["done", ""]]);
    expect(pairs(await reply("敲个木鱼", [chunk(null, [call(0, "play_action", `{"action":"wooden_fish"}`)], "tool_calls")]))).toEqual([["action", "wooden_fish"], ["done", ""]]);
  });

  it("hands over the calls the window saves, and how many were dropped", async () => {
    const reminder = `{"text":"开会","remind_at":"2026-11-19 09:00"}`;
    const events = await reply("明天九点提醒我开会", [chunk("好。", [call(0, "add_reminder", reminder), call(1, "play_action", `{"action":"wave"}`), call(9, "save_note", "{}")], "tool_calls")]);
    expect(pairs(events)).toEqual([
      ["delta", "好。"], ["action", "wave"],
      ["tool", JSON.stringify({ name: "add_reminder", arguments: reminder, overflow: false })],
      ["tool", JSON.stringify({ name: "", arguments: "", dropped: 1 })],
      ["done", ""],
    ]);
  });

  it("shows a looked-up list as it is", async () => {
    const events = await reply("我记了什么", [chunk("给你看。", [call(0, "list_notes", "{}")], "tool_calls")]);
    expect(pairs(events)).toEqual([["delta", "给你看。"], ["delta", "\n\n你的备忘：\n1. WiFi 密码 abc123"], ["done", ""]]);
  });

  it("answers a scoped lookup with a second, read-only request", async () => {
    platform.llmPlatform.stream.mockClear();
    const events = await run(chat("WiFi 密码是多少"), async (id) => {
      feed(id, [chunk(null, [call(0, "list_notes", `{"synthesize":true}`)], "tool_calls")]);
      await vi.waitFor(() => expect(platform.llmPlatform.stream).toHaveBeenCalledTimes(2));
      feed(id, [chunk("密码是 abc123。", [], "stop")]);
    });
    const second = platform.llmPlatform.stream.mock.calls[1][2] as { tools?: unknown; messages: Array<{ content: string }> };
    expect(second.tools).toBeUndefined();
    expect(second.messages[0].content).toContain("WiFi 密码 abc123");
    expect(pairs(events)).toEqual([["delta", "密码是 abc123。"], ["done", ""]]);
  });

  it("says so when the second request finds nothing to say", async () => {
    const events = await run(chat("WiFi 密码是多少"), async (id) => {
      platform.llmPlatform.stream.mockClear();
      feed(id, [chunk("查一下。", [call(0, "list_notes", `{"synthesize":true}`)], "tool_calls")]);
      await vi.waitFor(() => expect(platform.llmPlatform.stream).toHaveBeenCalledTimes(1));
      feed(id, [], { status: 500, ok: false, cancelled: false });
    });
    expect(pairs(events)).toEqual([["delta", "查一下。"], ["delta", "\n\n"], ["delta", "查到了记录，但暂时没法整理答案。可以在提醒或备忘面板查看。"], ["done", ""]]);
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

  it("gives the message back when the request cannot start", async () => {
    platform.llmPlatform.stream.mockRejectedValueOnce("API key is not configured");
    await expect(chat("hi")("never")).rejects.toBe("API key is not configured");
    expect(pairs(await reply("hi", [chunk("在。", [], "stop")]))).toEqual([["delta", "在。"], ["done", ""]]);
  });

  it("records each request in developer mode, without picture bytes", async () => {
    platform.llmPlatform.putLogEntry.mockClear();
    await run((id) => ai.start(id, [{ role: "user", content: "看图", imageData: "data:image/png;base64,aGVsbG8=" }], chatPreferences({ record: true }), null, "image"), (id) => feed(id, [chunk("是只猫。", [], "stop")]));
    const logged = platform.llmPlatform.putLogEntry.mock.calls;
    const entry = logged[logged.length - 1][0] as { window: string; rounds: Array<{ request: { messages: Array<{ content: unknown }> }; reply: string; ok: boolean }> };
    expect(entry.window).toBe("chat");
    expect(entry.rounds).toHaveLength(1);
    expect(entry.rounds[0]).toMatchObject({ reply: "是只猫。", ok: true });
    expect(JSON.stringify(entry.rounds[0].request)).toContain("[Image omitted]");
    expect(JSON.stringify(entry.rounds[0].request)).not.toContain("aGVsbG8=");
  });
});

describe("webpage replies", () => {
  const page = (id: string) => (packets: readonly object[]) => feed(id, packets);
  const readCall = { index: 0, id: "srvtoolu_test", type: READ_TOOL, kind: "read_link", status: "completed", page: { url: "https://example.com", title: "Example" }, signature: "opaque" };

  it("reports progress and sources without playing local tools", async () => {
    const events = await run((id) => ai.start(id, [{ role: "user", content: "请总结 https://example.com", readLink: "open" }], chatPreferences(), null, "open"), (id) => page(id)([
      { choices: [{ delta: {}, server_tool_event: { type: "call_started", call: { type: READ_TOOL } } }] },
      { choices: [{ delta: { content: "网页摘要", tool_calls: [call(0, "play_action", `{"action":"wooden_fish"}`)] }, server_tool_event: { type: "call_completed", call: readCall } }] },
      { choices: [{ delta: { server_tool_calls: [{ index: 0, calls: [readCall] }], annotations: [{ type: "url_citation", url_citation: { url: "https://example.com", title: "Example" } }] }, finish_reason: "stop" }] },
    ]));
    expect(pairs(events).slice(0, 3)).toEqual([["web-progress", "reading"], ["delta", "网页摘要"], ["web-progress", "read"]]);
    const result = events.find((event) => event.kind === "web-result");
    expect(JSON.parse(result?.text ?? "{}")).toMatchObject({ sources: [{ url: "https://example.com", title: "Example" }], incomplete: false, truncated: false, calls: expect.any(String) });
    expect(events.map((event) => event.kind)).not.toContain("action");
    expect(events[events.length - 1].kind).toBe("done");
  });

  it("explains a page it could not read, and a search that found nothing", async () => {
    const failed = await run((id) => ai.start(id, [{ role: "user", content: "https://example.com", readLink: "open" }], chatPreferences(), null, "open"), (id) => page(id)([
      { choices: [{ delta: {}, server_tool_event: { type: "call_completed", call: { type: READ_TOOL, status: "failed" } } }] },
      { choices: [{ delta: { content: "读不到" }, finish_reason: "stop" }] },
    ]));
    expect(pairs(failed)[failed.length - 1]).toEqual(["web-error", "没能读取网页，请检查链接是否能直接打开，或复制正文到聊天里。"]);
    const searched = await run((id) => ai.start(id, [{ role: "user", content: "最新消息", readLink: "search" }], chatPreferences(), null, "search"), (id) => page(id)([
      { choices: [{ delta: {}, server_tool_event: { type: "call_started", call: { type: SEARCH_TOOL } } }] },
      { choices: [{ delta: { content: "没找到" }, finish_reason: "stop" }] },
    ]));
    expect(pairs(searched)).toEqual([["web-progress", "searching"], ["delta", "没找到"], ["web-error", "没找到可引用的网页，试着换个问法再搜。"]]);
  });

  it("refuses as a webpage error", async () => {
    const events = await run((id) => ai.start(id, [{ role: "user", content: "https://example.com", readLink: "open" }], chatPreferences(), null, "open"), (id) => page(id)([chunk(null, [], "content_filter")]));
    expect(pairs(events)).toEqual([["web-error", "这条内容未能通过 DeepSeek 的审核。"]]);
  });
});

describe("text tasks", () => {
  it("streams the result without tools", async () => {
    platform.llmPlatform.stream.mockClear();
    const events = await run((id) => ai.translate(id, "hello", "zh", "deepseek-flash"), (id) => feed(id, [chunk("你好", [], "stop")]));
    expect(pairs(events)).toEqual([["delta", "你好"], ["done", ""]]);
    expect((platform.llmPlatform.stream.mock.calls[0][2] as { tools?: unknown }).tools).toBeUndefined();
  });
});
