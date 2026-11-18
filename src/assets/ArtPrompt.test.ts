import { describe, expect, it } from "vitest";
import { STANDARD_ACTIONS } from "../actions/StandardActions";
import { ACTION_SLOT, ART_CANVAS, ART_FIGURE_HEIGHT, ART_PROMPT_MAX_CHARS, DEFAULT_ART_PROMPTS, fillArtPrompt, usableArtPrompts } from "./ArtPrompt";

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

  it("gives every picture the same canvas size and character scale", () => {
    const size = `${ART_CANVAS.width}×${ART_CANVAS.height} 像素`;
    for (const prompt of [DEFAULT_ART_PROMPTS.first, DEFAULT_ART_PROMPTS.action]) {
      expect(prompt).toContain(size);
      expect(prompt).toContain(`${ART_FIGURE_HEIGHT} 像素`);
    }
    expect(ART_FIGURE_HEIGHT).toBeLessThan(ART_CANVAS.height);
  });

  it("asks no action for a canvas of its own shape", () => {
    for (const action of STANDARD_ACTIONS) expect(action.pose).not.toMatch(/横版|竖版|\d:\d/);
  });

  it("writes an action's name and pose into a template", () => {
    const prompt = fillArtPrompt(DEFAULT_ART_PROMPTS.action, { id: "wave", label: "挥手", pose: "站着挥手。" });

    expect(prompt).toContain("【这一张】挥手：站着挥手。");
    expect(prompt).not.toContain(ACTION_SLOT);
  });

  it("asks for transparent wooden fish frames with a separate effect", () => {
    const action = { id: "wooden_fish", label: "敲木鱼" };
    for (const template of [DEFAULT_ART_PROMPTS.action, "我的画风：水彩。{动作}"]) {
      const prompt = fillArtPrompt(template, action);
      expect(prompt).toContain("2 行 × 3 列的六宫格");
      expect(prompt).toContain("透明背景的 PNG");
      expect(prompt).toContain("不要画任何文字");
      expect(prompt).toContain("不跨格");
      expect(prompt).not.toContain(ACTION_SLOT);
    }
  });

  it("asks every picture for finished, clean quality that holds to the first one", () => {
    const woodenFish = fillArtPrompt(DEFAULT_ART_PROMPTS.action, { id: "wooden_fish", label: "敲木鱼" });
    for (const prompt of [DEFAULT_ART_PROMPTS.first, DEFAULT_ART_PROMPTS.action, woodenFish]) {
      expect(prompt).toContain("【画质】");
      expect(prompt).toContain("高清");
      expect(prompt).toContain("手指数量");
    }
    expect(DEFAULT_ART_PROMPTS.first).toContain("光从左上方来");
    for (const prompt of [DEFAULT_ART_PROMPTS.action, woodenFish]) expect(prompt).toContain("光源方向");
  });

  it("requests a transparent PNG for both single-image templates", () => {
    for (const prompt of [DEFAULT_ART_PROMPTS.first, DEFAULT_ART_PROMPTS.action]) {
      expect(prompt).toContain("透明背景的 PNG");
    }
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
