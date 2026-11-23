import { failed, type Skill, type Tool } from "../ai/skill";
import type { ChatContext } from "../ai/types";
import { petWindow } from "../platform/petWindow";

export const PLAY_ACTION_TOOL = "play_action";
const UNAVAILABLE = "这个动作现在播不了。";
const EXAMPLES: ReadonlyArray<[string, string]> = [["wooden_fish", "敲个木鱼"], ["happy", "做个开心的动作"], ["wave", "给我打个招呼"], ["remind", "摇铃提醒我"], ["shy", "做个害羞的表情"]];

/** Arguments of exactly one action the character has. */
function chosenAction(args: Record<string, unknown>, context: ChatContext): string | null {
  return Object.keys(args).length === 1 && typeof args.action === "string" && context.actions.includes(args.action) ? args.action : null;
}

const playAction: Tool = {
  name: PLAY_ACTION_TOOL,
  label: "当场做一个动作",
  description: "执行用户明确要求立即做的桌面宠物动作。明确要求时必须调用，并从 action 枚举选真实且语义匹配的 ID。普通聊天、问候、问答、情绪表达、角色扮演、询问动作能力、讨论动作或设计，以及因时间、性格、回复情绪产生的联想，都不调用。没有匹配项时直接说明，不编造 ID，不用别的动作冒充。睡觉、专注等持续状态由行为引擎管理，本工具只请求短时动作。",
  parameters: (context) => ({ type: "object", properties: { action: { type: "string", enum: context.actions } }, required: ["action"] }),
  // The pet moves while the reply is still being written.
  early: { ready: (args, context) => chosenAction(args, context) !== null },
  async run(args, call) {
    const id = chosenAction(args, call.context);
    // A cut, unknown or padded action must not become a different action.
    if (!id) { console.warn("The model returned incomplete or unavailable action arguments"); return failed(UNAVAILABLE); }
    try {
      const result = await petWindow.requestChatAction(id, call.requestId);
      if (result.accepted && result.actionId === id) return { result: "宠物开始做这个动作了。", confirmation: "好，来吧。" };
      console.warn("The pet declined a chat action", id, result);
      if (!result.accepted && result.reason === "busy") return failed("宠物现在正忙，暂时做不了这个动作。");
      if (!result.accepted && result.reason === "cooldown") return failed("这个动作刚做过，等一下再试。");
    } catch (error) {
      console.warn("Could not dispatch the chat action", id, error);
    }
    return failed(UNAVAILABLE);
  },
};

/** Asking the pet to do one of its actions now. Offered only when the character has some. */
export const petActionSkill: Skill = {
  id: "actions",
  title: "做动作",
  summary: "你说「敲个木鱼」时，边回话边做这个动作",
  available: (context) => context.actions.length > 0,
  rules(context) {
    const examples = EXAMPLES.filter(([id]) => context.actions.includes(id)).map(([id, request]) => `「${request}」→ ${id}`);
    const shown = examples.length > 0 ? ` 例如：${examples.join("、")}。` : "";
    return `只有用户明确要求宠物立即做某个动作时才调用 ${PLAY_ACTION_TOOL}，同时在本轮 assistant content 给一句自然的话，例如「来，给你敲一个。」不预报动作已经完成，不要在回复里用括号或星号描写动作。${shown} 询问「你有哪些动作」时按当前枚举介绍；「我们讨论一下木鱼动画」是讨论，直接回答。普通问候和情绪表达不调用。按枚举精确选择，不用相似动作代替；自主动作和持续状态由行为引擎接管。`;
  },
  tools: [playAction],
};
