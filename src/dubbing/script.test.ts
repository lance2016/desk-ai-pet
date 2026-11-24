import { describe, expect, it } from "vitest";
import { MAX_SEGMENT_CHARS, splitScript } from "./script";

describe("splitScript", () => {
  it("splits Chinese text at sentence ends", () => {
    expect(splitScript("大家好。今天讲三件事！第一件是什么？")).toEqual(["大家好。", "今天讲三件事！", "第一件是什么？"]);
  });

  it("keeps closing quotes with their sentence", () => {
    expect(splitScript("他说：“走吧。”我们就走了。")).toEqual(["他说：“走吧。”", "我们就走了。"]);
  });

  it("treats each line as its own piece and drops blank lines", () => {
    expect(splitScript("标题\n\n  第一段没有句号\r\n第二段")).toEqual(["标题", "第一段没有句号", "第二段"]);
  });

  it("splits English at a period followed by space, not inside numbers", () => {
    expect(splitScript("Version 3.5 is out. Try it now.")).toEqual(["Version 3.5 is out.", "Try it now."]);
  });

  it("keeps runs of end marks together", () => {
    expect(splitScript("真的吗？！太好了……")).toEqual(["真的吗？！", "太好了……"]);
  });

  it("adds a piece with nothing to say to the one before", () => {
    expect(splitScript("好的\n……")).toEqual(["好的……"]);
    expect(splitScript("——\n开始")).toEqual(["开始"]);
  });

  it("cuts a long sentence at a comma, then at the limit", () => {
    const clause = "一".repeat(MAX_SEGMENT_CHARS - 10);
    const pieces = splitScript(`${clause}，${"二".repeat(30)}。`);
    expect(pieces).toEqual([`${clause}，`, `${"二".repeat(30)}。`]);
    const solid = splitScript("三".repeat(MAX_SEGMENT_CHARS * 2 + 5));
    expect(solid.map((piece) => piece.length)).toEqual([MAX_SEGMENT_CHARS, MAX_SEGMENT_CHARS, 5]);
  });

  it("returns nothing for blank text", () => {
    expect(splitScript("  \n ")).toEqual([]);
  });
});
