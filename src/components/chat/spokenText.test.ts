import { describe, expect, it } from "vitest";
import { MAX_SPOKEN_CHARS, spokenText } from "./spokenText";

describe("spokenText", () => {
  it("reads a short reply as it is, without surrounding blank space", () => {
    expect(spokenText("  好的，明天提醒你。\n")).toBe("好的，明天提醒你。");
  });

  it("stops a long reply at the last sentence end that fits", () => {
    const sentence = "这是一句话。";
    const text = sentence.repeat(Math.ceil(MAX_SPOKEN_CHARS / sentence.length) + 5);
    const spoken = spokenText(text);
    expect(spoken.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    expect(spoken.endsWith("。")).toBe(true);
    expect(text.startsWith(spoken)).toBe(true);
  });

  it("cuts a long reply with no sentence end at the limit", () => {
    expect(spokenText("啊".repeat(MAX_SPOKEN_CHARS + 10))).toHaveLength(MAX_SPOKEN_CHARS);
  });

  it("counts characters, not UTF-16 units, like the native side", () => {
    const spoken = spokenText("🙂".repeat(MAX_SPOKEN_CHARS + 1));
    expect([...spoken]).toHaveLength(MAX_SPOKEN_CHARS);
  });
});
