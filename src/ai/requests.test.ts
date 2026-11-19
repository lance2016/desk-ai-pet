import { describe, expect, it } from "vitest";
import type { WebReply } from "../chat/ReadLinks";
import { chatPreferences, chatRequestContext } from "../testing/fixtures";
import { READ_TOOL, SEARCH_TOOL } from "./deepseek/web";
import { CHAT_SKILLS } from "../skills";
import { PLAY_ACTION_TOOL } from "../skills/petActions";
import { chatRequest, nextRound, textTaskRequest, validChatImage, webRequest } from "./requests";

const toolNames = (tools: object[] | undefined) => (tools ?? []).map((tool) => (tool as { function: { name: string } }).function.name);

const steps = [{ index: 0, calls: [{ type: READ_TOOL, status: "completed", page: { url: "https://example.com", title: "Example" }, signature: "opaque" }] }];
const page: WebReply = { sources: [{ url: "https://example.com", title: "Example" }], incomplete: false, truncated: false, calls: JSON.stringify(steps) };

describe("chatRequest", () => {
  it("leaves webpage turns out of a turn that has local tools", () => {
    const body = chatRequest([
      { role: "user", content: "请总结 https://example.com", readLink: "open" },
      { role: "assistant", content: "网页摘要", web: page },
      { role: "user", content: "敲个木鱼" },
    ], chatPreferences(), chatRequestContext({ actions: ["wooden_fish"] }), CHAT_SKILLS);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].content).toBe("敲个木鱼");
    expect(toolNames(body.tools)).toContain(PLAY_ACTION_TOOL);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("cleans replies saved with leaked syntax and drops ones that said nothing else", () => {
    const body = chatRequest([
      { role: "user", content: "跳个舞" },
      { role: "assistant", content: "好！ play_action\naction=dance" },
      { role: "user", content: "再来" },
      { role: "assistant", content: "<budget:token_budget>2</budget:token_budget>" },
      { role: "user", content: "嗯" },
    ], chatPreferences({ length: "normal" }), chatRequestContext(), CHAT_SKILLS);
    expect(body.messages.map((message) => message.content)).toEqual([expect.any(String), "跳个舞", "好！", "再来", "嗯"]);
    expect(body.max_tokens).toBe(1024);
  });
});

describe("webRequest", () => {
  const user = { role: "user" as const, content: "请总结 https://example.com", readLink: "open" as const };

  it("reads a page with only the last message and DeepSeek's reading tool", () => {
    const body = webRequest([{ role: "user", content: "Unrelated" }, user], "open");
    expect(body.tools).toEqual([{ type: READ_TOOL }]);
    expect(body.messages).toHaveLength(2);
    expect(webRequest([{ role: "user", content: "最新消息" }], "search").tools).toEqual([{ type: SEARCH_TOOL }]);
  });

  it("sends the saved page back on a follow-up, without tools", () => {
    const follow = webRequest([user, { role: "assistant", content: "网页摘要", web: page }, { role: "user", content: "还有哪些细节？", readLink: "follow" }], "follow");
    expect(follow.tools).toBeUndefined();
    expect(follow.messages[2].server_tool_calls).toEqual(steps);
    expect(() => webRequest([user, { role: "assistant", content: "网页摘要" }, { role: "user", content: "细节？" }], "follow")).toThrow("重新读取");
  });

  it("sends a picture inline", () => {
    const url = "data:image/png;base64,aGVsbG8=";
    const body = webRequest([{ role: "user", content: "帮我看截图", imageData: url }], "image");
    expect(body.model).toBe("deepseek-flash");
    expect(body.tools).toBeUndefined();
    expect(body.messages[1].content).toEqual([{ type: "text", text: "帮我看截图" }, { type: "image_url", image_url: { url } }]);
    expect(() => webRequest([{ role: "user", content: "看图" }], "image")).toThrow("图片");
  });
});

describe("validChatImage", () => {
  it("accepts only small inline JPEG or PNG data", () => {
    expect(validChatImage("data:image/jpeg;base64,aGVsbG8=")).toBe(true);
    expect(validChatImage("https://example.com/image.png")).toBe(false);
    expect(validChatImage("data:image/png;base64,=abc")).toBe(false);
    expect(validChatImage("data:image/png;base64,====")).toBe(false);
  });
});

describe("textTaskRequest", () => {
  it("sends only the text and the task rules", () => {
    const body = textTaskRequest("hello", "zh", "deepseek-pro");
    expect(body.model).toBe("deepseek-pro");
    expect(body.messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(body.tools).toBeUndefined();
    expect(() => textTaskRequest(" ", "zh", "deepseek-pro")).toThrow("16000");
    expect(() => textTaskRequest("字".repeat(6_000), "zh", "deepseek-pro")).toThrow("16000");
  });
});

describe("nextRound", () => {
  it("hands the model what it said and what each call came to", () => {
    const first = chatRequest([{ role: "user", content: "把三点的会改到四点" }], chatPreferences(), chatRequestContext(), CHAT_SKILLS);
    const call = { id: "call_1", name: "list_reminders", arguments: `{"synthesize":true}`, overflow: false };
    const next = nextRound(first, "我看看。", [{ call, result: "r1. 今天 15:00 开会" }], false);
    expect(next.tools).toEqual(first.tools);
    expect(next.tool_choice).toBeUndefined();
    expect(next.messages.slice(-2)).toEqual([
      { role: "assistant", content: "我看看。", tool_calls: [{ type: "function", id: "call_1", function: { name: "list_reminders", arguments: `{"synthesize":true}` } }] },
      { role: "tool", tool_call_id: "call_1", content: "r1. 今天 15:00 开会" },
    ]);
    expect(first.messages).toHaveLength(2);
  });

  it("lets the model call nothing in the last round, and fills in what the stream left out", () => {
    const first = chatRequest([{ role: "user", content: "hi" }], chatPreferences(), chatRequestContext(), CHAT_SKILLS);
    const last = nextRound(first, "", [{ call: { id: "", name: "save_note", arguments: "", overflow: true }, result: "没有做成" }], true);
    expect(last.tool_choice).toBe("none");
    expect(last.messages[2]).toMatchObject({ tool_calls: [{ id: "call_0", function: { arguments: "{}" } }] });
    expect(last.messages[3]).toEqual({ role: "tool", tool_call_id: "call_0", content: "没有做成" });
  });
});
