import { describe, expect, it } from "vitest";
import { ACTION_SLOT, ART_PROMPT_MAX_CHARS, DEFAULT_ART_PROMPTS, fillArtPrompt, usableArtPrompts } from "./ArtPrompt";

describe("art prompts", () => {
  it("ships two templates that each say where the action goes", () => {
    expect(DEFAULT_ART_PROMPTS.first).toContain(ACTION_SLOT);
    expect(DEFAULT_ART_PROMPTS.action).toContain(ACTION_SLOT);
    expect(DEFAULT_ART_PROMPTS.first.length).toBeLessThan(ART_PROMPT_MAX_CHARS);
    expect(DEFAULT_ART_PROMPTS.action.length).toBeLessThan(ART_PROMPT_MAX_CHARS);
  });

  it("settles the style in the first prompt and holds later pictures to it", () => {
    expect(DEFAULT_ART_PROMPTS.first).toContain("【画风】");
    expect(DEFAULT_ART_PROMPTS.first).toContain("参考图");
    expect(DEFAULT_ART_PROMPTS.action).not.toContain("【画风】");
    expect(DEFAULT_ART_PROMPTS.action).toContain("和定稿图一致");
  });

  it("writes an action's name and pose into a template", () => {
    const prompt = fillArtPrompt(DEFAULT_ART_PROMPTS.action, { id: "wave", label: "挥手", pose: "站着挥手。" });

    expect(prompt).toContain("【这一张】挥手：站着挥手。");
    expect(prompt).not.toContain(ACTION_SLOT);
  });

  it("describes an action without a pose by its name", () => {
    expect(fillArtPrompt(ACTION_SLOT, { id: "spin" })).toBe("spin：表现「spin」的样子。");
  });

  it("adds the action to a template whose slot was edited out", () => {
    expect(fillArtPrompt("像素风。\n", { id: "wave", label: "挥手", pose: "站着挥手。" })).toBe("像素风。\n\n【这一张】挥手：站着挥手。");
  });

  it("uses the default in place of a cleared prompt", () => {
    expect(usableArtPrompts({ first: "  \n", action: "我的模板" })).toEqual({ first: DEFAULT_ART_PROMPTS.first, action: "我的模板" });
  });
});
