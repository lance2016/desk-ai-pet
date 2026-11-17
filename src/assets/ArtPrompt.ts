import { isUserAction } from "../actions/UserActions";
import type { AnimationEntry } from "./Manifest";

const RULES = [
  "同一个角色：脸、发型、服装、配色和画风都和参考图一致，身材比例也保持不变。全身入画。",
  "透明背景的 PNG。不要地面、阴影、边框、文字和水印，也不要星星、爱心、Zzz、思考气泡这类装饰。动作说明里写到的、拿在手里的道具可以画。",
  "一张图只画一个角色、一个姿势。角色居中，脚踩在画布底边附近，四周少留空白，动作说明另有要求的除外。",
  "所有图里角色的大小一致，不要因为姿势不同把角色放大或缩小。",
  "默认用竖版画布（2:3），动作说明里写了横版的除外。",
  "轮廓清晰，头发和衣服的边缘干净，不要大片半透明或发光效果。",
];

function describe(action: AnimationEntry): string {
  const name = action.label ?? action.id;
  return `${name}：${action.pose ?? `表现「${name}」的样子。`}`;
}

/**
 * The prompt a user pastes into an image model (such as ChatGPT) together with a
 * reference picture, to get one picture for every action of the character.
 * The user's own actions are left out: they are drawn from whatever picture the user picks.
 */
export function buildArtPrompt(actions: readonly AnimationEntry[]): string {
  const list = actions.filter((action) => !isUserAction(action)).map((action, index) => `${index + 1}. ${describe(action)}`);
  return [
    "我要给桌面宠物做一套动作图。我上传的图片是角色参考图，请以它为准，一次只画一张。",
    "",
    "【每张图都要遵守】",
    ...RULES.map((rule, index) => `${index + 1}. ${rule}`),
    "",
    "【画图顺序】",
    "先只画第 1 张。我确认形象没问题后说“继续”，你再按清单顺序一次画一张，每张都以第 1 张为准保持一致。每张图下面写一行它的编号和名称，例如“1. 安静陪伴”。",
    "",
    `【动作清单，共 ${list.length} 张】`,
    ...list,
  ].join("\n");
}
