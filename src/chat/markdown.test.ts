import { describe, expect, it } from "vitest";
import { markdownToPlain, parseInline, parseMarkdown } from "./markdown";

describe("parseInline", () => {
  it("finds bold, italic and code, and leaves the rest as text", () => {
    expect(parseInline("先**喝水**，再*休息*，运行 `pnpm dev`")).toEqual([
      { kind: "text", text: "先" }, { kind: "strong", text: "喝水" }, { kind: "text", text: "，再" },
      { kind: "em", text: "休息" }, { kind: "text", text: "，运行 " }, { kind: "code", text: "pnpm dev" },
    ]);
  });

  it("finds Markdown links and bare web addresses", () => {
    expect(parseInline("看[官网](https://example.com/a)或 https://example.com/b。")).toEqual([
      { kind: "text", text: "看" }, { kind: "link", text: "官网", url: "https://example.com/a" },
      { kind: "text", text: "或 " }, { kind: "link", text: "https://example.com/b", url: "https://example.com/b" }, { kind: "text", text: "。" },
    ]);
  });

  it("keeps unfinished or spaced markers as plain text", () => {
    expect(parseInline("正在打**粗")).toEqual([{ kind: "text", text: "正在打**粗" }]);
    expect(parseInline("3 * 4 * 5")).toEqual([{ kind: "text", text: "3 * 4 * 5" }]);
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs, headings, lists and code", () => {
    const blocks = parseMarkdown("# 今天\n第一行\n第二行\n\n- 买牛奶\n* 开会\n\n1. 起床\n2、出门\n```\nconst a = 1;\n```");
    expect(blocks.map((block) => block.kind)).toEqual(["heading", "paragraph", "list", "list", "code"]);
    expect(blocks[1]).toEqual({ kind: "paragraph", lines: [[{ kind: "text", text: "第一行" }], [{ kind: "text", text: "第二行" }]] });
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ text: "买牛奶" }], [{ text: "开会" }]] });
    expect(blocks[3]).toMatchObject({ ordered: true, start: 1, items: [[{ text: "起床" }], [{ text: "出门" }]] });
    expect(blocks[4]).toEqual({ kind: "code", text: "const a = 1;" });
  });

  it("shows a code block that is still streaming", () => {
    expect(parseMarkdown("看：\n```\nlet x")).toEqual([{ kind: "paragraph", lines: [[{ kind: "text", text: "看：" }]] }, { kind: "code", text: "let x" }]);
  });

  it("does not mistake a decimal for a list", () => {
    expect(parseMarkdown("3.14 是圆周率")[0].kind).toBe("paragraph");
  });

  it("treats plain chat as one paragraph", () => {
    expect(parseMarkdown("当然啦！我一直都在哦～")).toEqual([{ kind: "paragraph", lines: [[{ kind: "text", text: "当然啦！我一直都在哦～" }]] }]);
  });

  it("turns tables, quotes and rules into plain text", () => {
    const blocks = parseMarkdown("> 引一句\n\n---\n\n| 名字 | 时间 |\n| --- | :---: |\n| 开会 | 15:00 |");
    expect(blocks).toEqual([
      { kind: "paragraph", lines: [[{ kind: "text", text: "引一句" }]] },
      { kind: "paragraph", lines: [[{ kind: "text", text: "名字　时间" }], [{ kind: "text", text: "开会　15:00" }]] },
    ]);
  });
});

describe("markdownToPlain", () => {
  it("drops the marks and keeps the line breaks", () => {
    expect(markdownToPlain("# 清单\n**先**喝水\n\n- 买菜\n- 做饭\n\n1. 起床\n2. 出门\n\n见[这里](https://a.cn)")).toBe("清单\n先喝水\n· 买菜\n· 做饭\n1. 起床\n2. 出门\n见这里（https://a.cn）");
  });
});
