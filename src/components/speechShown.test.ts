import { describe, expect, it } from "vitest";
import { speechShown } from "./speechShown";

const question = { text: "刚开始专注，要停下吗？", choices: [], immediate: true };
const reminder: { text: string; immediate?: boolean } = { text: "喝水" };

describe("speechShown", () => {
  it("lets a passing line finish before a standing one comes up", () => {
    expect(speechShown("早上好", reminder, false)).toEqual({ line: "早上好", standing: null });
    expect(speechShown(null, reminder, false)).toEqual({ line: null, standing: reminder });
  });

  it("puts a question the user just asked for over the passing line at once", () => {
    expect(speechShown("好，我陪你专注 25 分钟！", question, false)).toEqual({ line: null, standing: question });
  });

  it("gives the bubble to a quick chat answer", () => {
    expect(speechShown(null, question, true)).toEqual({ line: null, standing: null });
  });
});
