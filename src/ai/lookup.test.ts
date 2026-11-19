import { describe, expect, it } from "vitest";
import { clipLocalLookup, lookupResults } from "./lookup";
import { ADD_REMINDER_TOOL, LIST_NOTES_TOOL, LIST_REMINDERS_TOOL, PLAY_ACTION_TOOL, REVIEW_TODAY_TOOL } from "./tools";

const calls = (names: readonly string[]) => names.map((name) => ({ name, arguments: "{}", overflow: false }));
const saved = { reminders: ["今天 15:00 开会"], notes: ["WiFi 密码\nabc123", "买牛奶"], today: ["完成了提醒：交周报"] };

describe("lookupResults", () => {
  it("shows the actual lists without a second request", () => {
    let result = lookupResults(calls([LIST_NOTES_TOOL]), saved);
    expect(result.sources).toBe("");
    expect(result.local).toContain("1. WiFi 密码\n   abc123\n2. 买牛奶");
    expect(result.local).not.toContain("开会");
    result = lookupResults(calls([LIST_REMINDERS_TOOL, REVIEW_TODAY_TOOL]), saved);
    expect(result.sources).toBe("");
    expect(result.local).toContain("今天 15:00 开会");
    expect(result.local).toContain("- 完成了提醒：交周报");
  });

  it("hands only scoped lookups to a second request", () => {
    const scoped = calls([LIST_NOTES_TOOL, ADD_REMINDER_TOOL, PLAY_ACTION_TOOL]);
    scoped[0].arguments = `{"synthesize":true}`;
    const result = lookupResults(scoped, saved);
    expect(result.local).toBe("");
    expect(result.sources).toContain("WiFi 密码");
    expect(result.sources).not.toContain("开会");
  });

  it("says when a list is empty, and asks for more on a thin day", () => {
    expect(lookupResults(calls([LIST_REMINDERS_TOOL]), { reminders: [], notes: [], today: [] }).local).toBe("你现在没有提醒。");
    expect(lookupResults(calls([REVIEW_TODAY_TOOL]), saved).local).toContain("今天还做了什么？");
    expect(lookupResults(calls([REVIEW_TODAY_TOOL]), { ...saved, today: ["还没处理的提醒：交周报", "专注了 2 轮"] }).local).toBe("- 待跟进：交周报\n- 专注了 2 轮");
  });
});

describe("clipLocalLookup", () => {
  it("keeps whole lines and says the rest is in the panel", () => {
    const long = Array.from({ length: 2_000 }, (_, index) => `${index}. 备忘内容`).join("\n");
    const clipped = clipLocalLookup(long);
    expect(new TextEncoder().encode(clipped).length).toBeLessThan(12_200);
    expect(clipped.endsWith("可到对应面板查看全部。")).toBe(true);
    expect(clipped.split("\n\n")[0].endsWith("备忘内容")).toBe(true);
    expect(clipLocalLookup("短")).toBe("短");
  });
});
