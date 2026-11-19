import { AGENDA_LIMITS } from "../agenda/AgendaStore";
import { NOTE_LIMITS } from "../notes/NoteStore";

/** Tool names. `src/agenda/chatTools.ts` reads the saving calls. */
export const ADD_REMINDER_TOOL = "add_reminder";
export const SAVE_NOTE_TOOL = "save_note";
export const PLAY_ACTION_TOOL = "play_action";
/** Lookups answered here from the request's context; the window never sees these calls. */
export const LIST_REMINDERS_TOOL = "list_reminders";
export const LIST_NOTES_TOOL = "list_notes";
export const REVIEW_TODAY_TOOL = "review_today";
export const LOOKUP_TOOLS: readonly string[] = [LIST_REMINDERS_TOOL, LIST_NOTES_TOOL, REVIEW_TODAY_TOOL];

/** Pet actions offered to the model at most. */
export const MAX_ACTIONS = 30;
export const ACTION_ID = /^[a-z0-9_]{1,40}$/;

export const ACTION_DESCRIPTION = "执行用户明确要求立即做的桌面宠物动作。明确要求时必须调用，并从 action 枚举选真实且语义匹配的 ID。普通聊天、问候、问答、情绪表达、角色扮演、询问动作能力、讨论动作或设计，以及因时间、性格、回复情绪产生的联想，都不调用。没有匹配项时直接说明，不编造 ID，不用别的动作冒充。睡觉、专注等持续状态由行为引擎管理，本工具只请求短时动作。";

const SYNTHESIZE = { type: "boolean", description: "只在用户要求按条件从记录中找答案、筛选或做复杂归纳时填 true。直接查看完整列表或基础日报时省略，由应用展示。" };

const fn = (name: string, description: string, parameters: object) => ({ type: "function", function: { name, description, parameters } });

/**
 * Tools the model may call: set a reminder (always with a time), keep a note, look up what is saved, and pick
 * an action for the pet. The split is by time alone, so the model never has to guess what "记一下" means.
 */
export function toolDefinitions(actions: readonly string[]): object[] {
  const tools = [
    fn(ADD_REMINDER_TOOL, "用户明确要提醒或记录某事，且给出日期、钟点或相对时间时，新建一条未来提醒。单纯聊到一个日期或时间不调用。保存结果由应用确认。", {
      type: "object",
      properties: {
        text: { type: "string", description: `要提醒的事，简短，不超过 ${AGENDA_LIMITS.text} 字，不含时间` },
        remind_at: { type: "string", description: "提醒时间，用户本地时间，格式 YYYY-MM-DD HH:mm，必须晚于现在。用户只说了钟点、而今天这个钟点已经过了，就用明天的。只说了日期没说钟点，用当天 09:00。重复提醒填第一次提醒的时间" },
        repeat: { type: "string", description: "重复规则，只提醒一次就省略。只支持三种：每个工作日（按中国法定节假日和调休）填 workdays；每天填 daily；每周固定几天填星期数字，用英文逗号分隔，1 是周一，7 是周日，如 1,3,5。每月、每年、隔周、每隔几天等其他规则都不支持，不要调用，如实告诉用户做不到" },
      },
      required: ["text", "remind_at"],
    }),
    fn(SAVE_NOTE_TOOL, "用户明确要求记录且未指定时间时，新建一条备忘，例如记下待办、地址或想法。保存结果由应用确认。", {
      type: "object",
      properties: { text: { type: "string", description: `要保存的内容，保留用户给的原文和换行，不超过 ${NOTE_LIMITS.text} 字` } },
      required: ["text"],
    }),
    fn(LIST_REMINDERS_TOOL, "查看用户的全部提醒：还没处理的按时间排序，以及做完的。用户问今天、明天有什么事，某件事几点，提醒过没有时使用。", { type: "object", properties: { synthesize: SYNTHESIZE } }),
    fn(LIST_NOTES_TOOL, "查看用户存的全部备忘。用户问起以前记下的东西时使用，例：“WiFi 密码是多少”“我记过哪些要买的”。", { type: "object", properties: { synthesize: SYNTHESIZE } }),
    fn(REVIEW_TODAY_TOOL, "查看用户今天的记录：今天完成了哪些提醒、今天还有哪些提醒没处理、专注了几轮、今天记了哪些备忘。用户要写日报、回顾今天做了什么时使用。", { type: "object", properties: { synthesize: SYNTHESIZE } }),
  ];
  if (actions.length > 0) {
    tools.push(fn(PLAY_ACTION_TOOL, ACTION_DESCRIPTION, { type: "object", properties: { action: { type: "string", enum: actions } }, required: ["action"] }));
  }
  return tools;
}
