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

/**
 * Every picture is drawn on the same square canvas with the character at the
 * same scale, so pictures line up with one another. Square is the image
 * model's default size, which it keeps to most reliably across a long chat;
 * it also holds a lying or arms-up pose at the standing scale.
 */
export const ART_CANVAS = { width: 1024, height: 1024 } as const;
/** Head to toe when standing up straight: three quarters of the canvas. */
export const ART_FIGURE_HEIGHT = 760;
/** From the feet to the bottom edge. */
export const ART_GROUND_GAP = 40;

const CANVAS = `画布：正方形 ${ART_CANVAS.width}×${ART_CANVAS.height} 像素（1:1）。每一张都用这个尺寸，不要改成竖版或横版，也不要裁切或加白边。`;
const FRAMING = "只画一个角色、一个姿势，全身都在画布里，左右居中";
const CLEAN_EDGES = "轮廓清晰，头发和衣服的边缘干净，不要大片半透明或发光效果。";

const WOODEN_FISH_PROMPT = [
  "我上传的图片是桌面宠物角色定稿图。请以它为参考，绘制一张 2 行 × 3 列的六宫格逐帧动画素材，表现同一个角色敲一次木鱼。",
  "",
  "【动作】跪坐在坐垫上，面前放木鱼，闭眼微笑。按从左到右、从上到下排列：第 1 帧举起木槌；第 2 帧开始挥下；第 3 帧接近木鱼；第 4 帧敲中木鱼；第 5 帧木槌弹起；第 6 帧回到举槌位置，与第 1 帧自然衔接。",
  "",
  "【要求】",
  ...numbered([
    "整张图片为真正透明背景的 PNG，不要白底、棋盘格、地面、阴影、边框、分隔线或水印。",
    "六格严格等宽等高，每格正方形，每格完整容纳角色和道具并留透明边距，不跨格，方便按 2 行 3 列裁切。",
    "六格的角色、脸、发型、衣服、配色和比例与定稿图一致；头部、身体、坐垫和木鱼的位置及大小保持不变，主要改变持槌手臂和木槌。",
    "不要画任何文字、数字或飘字特效；功德 +1 由应用独立添加。",
    `每格以 ${ART_CANVAS.width}×${ART_CANVAS.height} 像素设计，保持站直时约 ${ART_FIGURE_HEIGHT} 像素的角色比例，底部留约 ${ART_GROUND_GAP} 像素；整张图为 3072×2048 像素。`,
    CLEAN_EDGES,
  ]),
].join("\n");

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
      CANVAS,
      `角色大小：站直时从头顶到脚底约 ${ART_FIGURE_HEIGHT} 像素（画布高度的四分之三），脚底离画布底边约 ${ART_GROUND_GAP} 像素。`,
      `${FRAMING}。`,
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
      "同一个角色：脸、发型、服装、配色和画风都和定稿图一致，头身比例不变。",
      "透明背景的 PNG。不要地面、阴影、边框、文字和水印，也不要星星、爱心、Zzz、思考气泡这类装饰。动作说明里写到的、拿在手里的道具可以画。",
      CANVAS,
      `角色大小和定稿图一样：按站直时身高约 ${ART_FIGURE_HEIGHT} 像素的比例来画。举手、跳起、弯腰、躺下都不要为了装进画面把角色缩小，也不要放大。身体最低处（脚底，躺下时是贴地的一侧）离画布底边约 ${ART_GROUND_GAP} 像素。`,
      `${FRAMING}，动作说明另有要求的除外。`,
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
  if (action.id === "wooden_fish") {
    if (template === DEFAULT_ART_PROMPTS.action) return WOODEN_FISH_PROMPT;
    return `${WOODEN_FISH_PROMPT}\n\n【补充参考】以下是我为角色写的动作模板；其中与上述六宫格、透明背景及文字特效冲突的要求以上述要求为准：\n${template.split(ACTION_SLOT).join(describe(action))}`;
  }
  const text = describe(action);
  return template.includes(ACTION_SLOT) ? template.split(ACTION_SLOT).join(text) : `${template.trimEnd()}\n\n【这一张】${text}`;
}
