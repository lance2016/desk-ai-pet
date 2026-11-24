import { describe, expect, it } from "vitest";
import { type Clip, linesOf, nextLines, progressOf, withoutStale } from "./clips";

const lines = linesOf(["一。", "二。", "一。", "三。"], "冰糖", "");
const ready: Clip = { status: "ready", pcm: new Uint8Array(2) };

describe("linesOf", () => {
  it("gives the same sentence read the same way the same key", () => {
    expect(lines[0].key).toBe(lines[2].key);
    expect(lines[0].key).not.toBe(linesOf(["一。"], "茉莉", "")[0].key);
    expect(lines[0].key).not.toBe(linesOf(["一。"], "冰糖", "慢一点")[0].key);
  });
});

describe("nextLines", () => {
  it("starts lines without audio in order, each sentence once, up to the free slots", () => {
    expect(nextLines(lines, new Map(), 0, 3).map((line) => line.text)).toEqual(["一。", "二。", "三。"]);
    expect(nextLines(lines, new Map(), 2, 3).map((line) => line.text)).toEqual(["一。"]);
    const clips = new Map<string, Clip>([[lines[0].key, ready], [lines[1].key, { status: "making" }]]);
    expect(nextLines(lines, clips, 1, 3).map((line) => line.text)).toEqual(["三。"]);
  });

  it("leaves a failed line until the next run", () => {
    const clips = new Map<string, Clip>([[lines[0].key, { status: "failed", error: "x" }]]);
    expect(nextLines(lines, clips, 0, 3).map((line) => line.text)).toEqual(["二。", "三。"]);
    expect(withoutStale(clips, lines, { failed: true }).size).toBe(0);
  });
});

describe("withoutStale", () => {
  it("drops audio for lines no longer in the script", () => {
    const old = linesOf(["旧的。"], "冰糖", "")[0];
    const clips = new Map<string, Clip>([[old.key, ready], [lines[1].key, ready]]);
    expect([...withoutStale(clips, lines).keys()]).toEqual([lines[1].key]);
  });
});

describe("progressOf", () => {
  it("counts every line, a repeated one too", () => {
    const clips = new Map<string, Clip>([[lines[0].key, ready], [lines[3].key, { status: "failed", error: "x" }]]);
    expect(progressOf(lines, clips)).toEqual({ total: 4, ready: 2, failed: 1, missing: 1 });
  });
});
