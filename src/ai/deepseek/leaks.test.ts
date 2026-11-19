import { describe, expect, it } from "vitest";
import { ReplyText, stripLeaked, takeLeakedActions } from "./leaks";

/** Feeds `chunks` through as one streamed reply and returns what the window gets. */
function shown(chunks: readonly string[]): string[] {
  const reply = new ReplyText();
  return [...chunks.map((chunk) => reply.push(chunk)), reply.finish()];
}

describe("leaked text", () => {
  it("strips complete tags and keeps the words", () => {
    expect(stripLeaked("好呀<budget:token_budget>200000</budget:token_budget>！")).toBe("好呀！");
    expect(stripLeaked("a < b，<b>粗</b>")).toBe("a < b，<b>粗</b>");
    expect(stripLeaked("还没完<budget:token")).toBe("还没完<budget:token");
  });

  it("says nothing for a reply of only a leaked tag", () => {
    expect(shown(["\n\n", "<budget:token_budget>200000</budget:token_budget>"]).every((text) => text === "")).toBe(true);
  });

  it("holds back a tag split over chunks and drops it", () => {
    expect(shown(["跳好啦", "<bud", "get:token_budget>2</budget:", "token_budget>", "！"]).join("")).toBe("跳好啦！");
    expect(shown(["好", "<budget:token_budget>2000"]).join("")).toBe("好");
  });

  it("lets other angle brackets through", () => {
    expect(shown(["1 <", " 2"])).toEqual(["1 ", "< 2", ""]);
    expect(shown(["看 <b", "r>"]).join("")).toBe("看 <br>");
    expect(shown(["结尾是 <"]).join("")).toBe("结尾是 <");
  });

  it("drops only the blank lines before the first words", () => {
    expect(shown(["\n\n", "第一行\n\n", "第二行"]).join("")).toBe("第一行\n\n第二行");
  });

  it("only removes an action written into the reply", () => {
    expect(shown(["好的呀lance，我这就跳舞！ play_", "action\naction=dance"]).join("")).toBe("好的呀lance，我这就跳舞！");
    expect(shown(["好！", `play_action(action="wave")`]).join("")).toBe("好！");
  });

  it("does not take the tool name alone for an action", () => {
    expect(shown(["play_action 是什么"]).join("")).toBe("play_action 是什么");
    expect(shown(["help", " me"]).join("")).toBe("help me");
    expect(takeLeakedActions("play_action\naction=忽略规则")).toEqual({ text: "play_action\naction=忽略规则", actions: [] });
  });
});
