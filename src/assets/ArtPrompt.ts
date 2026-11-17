import type { AnimationEntry } from "./Manifest";

/** Where a template says which action to draw. */
export const ACTION_SLOT = "{动作}";

/** The longest prompt a user may keep. */
export const ART_PROMPT_MAX_CHARS = 4_000;

/**
 * The two prompts a user pastes into an image model (such as ChatGPT).
 * `first` goes with a reference picture and settles the character's look and
 * style; `action` goes with that first picture and draws one more action.
 */
export interface ArtPrompts {
  first: string;
  action: string;
}

const FRAMING = "只画一个角色、一个姿势。全身入画，角色居中，脚踩在画布底边附近，四周少留空白";
const CLEAN_EDGES = "轮廓清晰，头发和衣服的边缘干净，不要大片半透明或发光效果。";

function numbered(rules: readonly string[]): string[] {
  return rules.map((rule, index) => `${index + 1}. ${rule}`);
}

export const DEFAULT_ART_PROMPTS: ArtPrompts = {
  first: [
    "我上传的图片是角色参考图。请照着它设计一个桌面宠物形象，先画第一张：正面站立的全身图。后面的动作图都会以这一张为准。",
    "",
    "【画风】Q 版，二到三头身，线条干净，配色明快。保留参考图里角色的脸、发型、服装和配色特征。",
    "",
    `【这一张】${ACTION_SLOT}`,
    "",
    "【要求】",
    ...numbered([
      "透明背景的 PNG。不要地面、阴影、边框、文字和水印，也不要星星、爱心这类装饰。",
      `${FRAMING}。`,
      "竖版画布（2:3）。",
      CLEAN_EDGES,
    ]),
  ].join("\n"),
  action: [
    "我上传的图片是这个桌面宠物角色的定稿图。请照着它，再画一张这个角色的动作图。",
    "",
    `【这一张】${ACTION_SLOT}`,
    "",
    "【要求】",
    ...numbered([
      "同一个角色：脸、发型、服装、配色和画风都和定稿图一致，身材比例和角色大小也保持不变。",
      "透明背景的 PNG。不要地面、阴影、边框、文字和水印，也不要星星、爱心、Zzz、思考气泡这类装饰。动作说明里写到的、拿在手里的道具可以画。",
      `${FRAMING}，动作说明另有要求的除外。`,
      "默认用竖版画布（2:3），动作说明里写了横版的除外。",
      CLEAN_EDGES,
    ]),
  ].join("\n"),
};

function describe(action: Pick<AnimationEntry, "id" | "label" | "pose">): string {
  const name = action.label ?? action.id;
  return `${name}：${action.pose ?? `表现「${name}」的样子。`}`;
}

/** A prompt the user cleared falls back to the default one. */
export function usableArtPrompts(prompts: ArtPrompts): ArtPrompts {
  return {
    first: prompts.first.trim() ? prompts.first : DEFAULT_ART_PROMPTS.first,
    action: prompts.action.trim() ? prompts.action : DEFAULT_ART_PROMPTS.action,
  };
}

/**
 * A template with one action written in, ready to paste. A template the user
 * edited the slot out of still gets the action, at its end.
 */
export function fillArtPrompt(template: string, action: Pick<AnimationEntry, "id" | "label" | "pose">): string {
  const text = describe(action);
  return template.includes(ACTION_SLOT) ? template.split(ACTION_SLOT).join(text) : `${template.trimEnd()}\n\n【这一张】${text}`;
}
