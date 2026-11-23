import type { ChatContext } from "../ai/types";
import type { Skill, Tool, ToolCall, ToolOutcome } from "../ai/skill";
import { addAgendaItem, AGENDA_LIMITS, editAgendaItem, isDone, itemSummary, loadAgenda, removeAgendaItem, restoreAgendaItem, setAgendaItemDone, sortAgenda, type AgendaItem } from "../agenda/AgendaStore";
import { FALLBACK_REASONS, loadSavedItems, PAST_TOLERANCE_MS, parseLocalTime, readReminderCall, readText, reminderConfirmation, reminderLines } from "../agenda/chatTools";
import { parseRepeat, type Repeat } from "../agenda/Repeat";
import { changeReminders, keepNote } from "../worklog/store";
import { isOutcome, listTool, newId, notChanged, notSaved, refParameter, textParameter, TRIMMED, undoLine, writing } from "./items";
import { SAVE_NOTE_TOOL } from "./notes";
import { itemId } from "./refs";

export const LIST_REMINDERS_TOOL = "list_reminders";
export const ADD_REMINDER_TOOL = "add_reminder";
export const UPDATE_REMINDER_TOOL = "update_reminder";
export const COMPLETE_REMINDER_TOOL = "complete_reminder";
export const DELETE_REMINDER_TOOL = "delete_reminder";

/** The repeat rule that turns a repeating reminder back into a one-off. */
const ONCE = "once";
const REF = refParameter(LIST_REMINDERS_TOOL, "r2");
const REMIND_AT = "提醒时间，用户本地时间，格式 YYYY-MM-DD HH:mm，必须晚于现在。用户只说了钟点、而今天这个钟点已经过了，就用明天的。只说了日期没说钟点，用当天 09:00。重复提醒填第一次提醒的时间";
const REPEAT = "重复规则，只提醒一次就省略。只支持三种：每个工作日（按中国法定节假日和调休）填 workdays；每天填 daily；每周固定几天填星期数字，用英文逗号分隔，1 是周一，7 是周日，如 1,3,5。每月、每年、隔周、每隔几天等其他规则都不支持，不要调用，如实告诉用户做不到";
/** Why a reminder could not be set when it cannot fall back to a note. */
const NOT_KEPT_AS_NOTE: Record<keyof typeof FALLBACK_REASONS, string> = { past: "时间已经过了", "no-time": "没听懂时间" };

/** Whether a reminder without a usable time may be kept as a note: notes and saving them are both on. */
const keepsNotes = (context: ChatContext): boolean => !context.skillsOff?.includes("notes") && !context.toolsOff?.includes(SAVE_NOTE_TOOL);

/** Puts a reminder back as it was: replaced if it is still there, restored if it was removed. Undo is the user's own doing. */
function putBack(before: AgendaItem): void {
  changeReminders((items) => (items.some((item) => item.id === before.id) ? items.map((item) => (item.id === before.id ? before : item)) : restoreAgendaItem(items, before)), "user");
}

function findReminder(args: Record<string, unknown>, call: ToolCall): AgendaItem | ToolOutcome {
  if (typeof args.ref !== "string" || !args.ref.trim()) return notChanged("没说是哪一条提醒");
  const id = itemId(call, "reminder", args.ref);
  if (!id) return notChanged(`找不到编号 ${args.ref} 的提醒，先用 ${LIST_REMINDERS_TOOL} 查一下`);
  return loadAgenda().find((item) => item.id === id) ?? notChanged("这条提醒已经不在了");
}

/** The changed repeat rule, null for a one-off, or undefined when the model asked for one the app cannot keep. */
function changedRepeat(value: unknown, current: Repeat | null): Repeat | null | undefined {
  if (typeof value !== "string" || !value.trim()) return current;
  return value.trim() === ONCE ? null : parseRepeat(value) ?? undefined;
}

const listReminders = listTool(LIST_REMINDERS_TOOL, "查看提醒", "查看用户的全部提醒：还没处理的按时间排序，以及做完的。用户问今天、明天有什么事，某件事几点，提醒过没有，或要修改、删除提醒时使用。", "reminder", "你的提醒", "你现在没有提醒。", () => {
  const now = Date.now();
  const items = sortAgenda(loadSavedItems().agenda, now);
  return { ids: items.map((item) => item.id), texts: reminderLines(items, now) };
});

const addReminder: Tool = {
  name: ADD_REMINDER_TOOL,
  label: "新建提醒",
  description: "用户明确要提醒或记录某事，且给出日期、钟点或相对时间时，新建一条未来提醒。单纯聊到一个日期或时间不调用。保存结果由应用确认。",
  parameters: () => ({
    type: "object",
    properties: { text: textParameter(`要提醒的事，简短，不超过 ${AGENDA_LIMITS.text} 字，不含时间`), remind_at: textParameter(REMIND_AT), repeat: textParameter(REPEAT) },
    required: ["text", "remind_at"],
  }),
  run: (args, call) => writing(() => {
    const now = Date.now();
    const request = readReminderCall(args, now, newId);
    if (request.kind === "failed") return notSaved(request.reason);
    if (request.kind === "note") {
      const fallback = request.note.fallback ?? "no-time";
      if (!keepsNotes(call.context)) return notSaved(NOT_KEPT_AS_NOTE[fallback]);
      const reason = FALLBACK_REASONS[fallback];
      const saved = keepNote(request.note.text, "chat");
      const text = `${reason}：${saved.text}${request.note.trimmed ? TRIMMED : ""}`;
      return { result: text, lines: [{ kind: "note", id: saved.id, text }], confirmation: reason };
    }
    const { item } = request;
    changeReminders((list) => addAgendaItem(list, item, now), "chat");
    const marks = `${item.trimmed ? TRIMMED : ""}${item.onceOnly ? "（这种重复方式不支持，只提醒一次）" : ""}`;
    const summary = itemSummary(item, now);
    return { result: `已设提醒：${summary}`, lines: [{ kind: "agenda", id: item.id, text: `已设提醒：${summary}${marks}` }], confirmation: reminderConfirmation(item, now) };
  }),
};

const updateReminder: Tool = {
  name: UPDATE_REMINDER_TOOL,
  label: "修改提醒",
  description: `修改一条已有的提醒：文字、时间或重复规则。先用 ${LIST_REMINDERS_TOOL} 拿到编号。只填要改的项。`,
  requires: [LIST_REMINDERS_TOOL],
  parameters: () => ({
    type: "object",
    properties: {
      ref: REF,
      text: textParameter(`新的事项文字，不改就省略，不超过 ${AGENDA_LIMITS.text} 字`),
      remind_at: textParameter("新的提醒时间，格式 YYYY-MM-DD HH:mm，不改就省略"),
      repeat: textParameter(`新的重复规则，写法同 ${ADD_REMINDER_TOOL}；改成只提醒一次填 ${ONCE}；不改就省略`),
    },
    required: ["ref"],
  }),
  run: (args, call) => writing(() => {
    const before = findReminder(args, call);
    if (isOutcome(before)) return before;
    const now = Date.now();
    const text = typeof args.text === "string" ? readText(args.text, AGENDA_LIMITS.text) : null;
    const remindAt = typeof args.remind_at === "string" ? parseLocalTime(args.remind_at) : before.remindAt;
    if (remindAt === null) return notChanged("没看懂新的时间");
    const repeat = changedRepeat(args.repeat, before.repeat);
    if (repeat === undefined) return notChanged("这种重复方式不支持");
    if (repeat === null && remindAt !== before.remindAt && remindAt < now - PAST_TOLERANCE_MS) return notChanged("新的时间已经过了");
    const after = changeReminders((items) => editAgendaItem(items, before.id, { text: text?.text ?? before.text, remindAt, repeat }, now), "chat").find((item) => item.id === before.id) ?? before;
    const summary = itemSummary(after, now);
    return {
      result: `已改好：${summary}`,
      lines: [undoLine({ kind: "agenda", id: after.id, text: `已改提醒：${summary}${text?.trimmed ? TRIMMED : ""}` }, () => putBack(before))],
      confirmation: `好，改好了：${summary}`,
    };
  }),
};

const completeReminder: Tool = {
  name: COMPLETE_REMINDER_TOOL,
  label: "把提醒标成做完",
  description: `用户说某条提醒的事做完了时，把它标记为完成，和在提醒面板里点「完成」一样；重复提醒只勾掉这一次。先用 ${LIST_REMINDERS_TOOL} 拿到编号。`,
  requires: [LIST_REMINDERS_TOOL],
  parameters: () => ({ type: "object", properties: { ref: REF }, required: ["ref"] }),
  run: (args, call) => writing(() => {
    const before = findReminder(args, call);
    if (isOutcome(before)) return before;
    const now = Date.now();
    if (isDone(before, now)) return { result: `这条本来就是完成的：${before.text}`, confirmation: "这条已经勾掉了" };
    changeReminders((items) => setAgendaItemDone(items, before.id, true, now), "chat");
    return {
      result: `已完成：${before.text}`,
      lines: [undoLine({ kind: "agenda", id: before.id, text: `已完成提醒：${before.text}` }, () => putBack(before))],
      confirmation: `好，「${before.text}」勾掉了`,
    };
  }),
};

const deleteReminder: Tool = {
  name: DELETE_REMINDER_TOOL,
  label: "删除提醒",
  description: `删除一条已有的提醒。先用 ${LIST_REMINDERS_TOOL} 拿到编号。用户只是说做完了，用 ${COMPLETE_REMINDER_TOOL}，不要删除。`,
  requires: [LIST_REMINDERS_TOOL],
  parameters: () => ({ type: "object", properties: { ref: REF }, required: ["ref"] }),
  run: (args, call) => writing(() => {
    const before = findReminder(args, call);
    if (isOutcome(before)) return before;
    changeReminders((items) => removeAgendaItem(items, before.id), "chat");
    const summary = itemSummary(before, Date.now());
    return {
      result: `已删除：${summary}`,
      lines: [undoLine({ kind: "agenda", text: `已删除提醒：${summary}` }, () => putBack(before))],
      confirmation: `好，删掉了：${before.text}`,
    };
  }),
};

/** Reminders: things with a time, set, looked up, changed, ticked off and removed. */
export const remindersSkill: Skill = {
  id: "reminders",
  title: "提醒",
  summary: "你说「明天九点提醒我开会」时设提醒，也能查、改、勾掉和删除",
  rules: () => `用户明确要求提醒或记录、且给了日期或时间时，用 ${ADD_REMINDER_TOOL}。提醒必须在未来：只给钟点且今天已过，就用明天；只给日期就用当地当天 09:00。指定每天、每个工作日或每周几时按工具说明填写 repeat；其他重复规则如实说明无法设置，不要擅自改成一次性提醒，也不要承诺以后帮忙续上；可以问用户要不要先只设下一次。每条新提醒都要实际调用工具，是否保存成功、何时提醒由应用确认。聊天里出现日期，不代表用户要设提醒。用户问有哪些事、某件事几点时调用 ${LIST_REMINDERS_TOOL}，不要用聊天历史代替实际记录；直接查看清单时由应用展示结果，无需先说“我查一下”；查询特定事项、日期范围、需要归纳，或要修改、删除某条时设 synthesize=true。修改或删除提醒时，先用 ${LIST_REMINDERS_TOOL} 并设 synthesize=true 拿到编号，再用 ${UPDATE_REMINDER_TOOL} 或 ${DELETE_REMINDER_TOOL} 按编号处理；用户说某件事做完了，同样先查编号，再用 ${COMPLETE_REMINDER_TOOL} 勾掉，不要删除；编号只在这次回复里有效。对不上或有几条都可能时，先问用户是哪一条，不要猜。`,
  tools: [listReminders, addReminder, updateReminder, completeReminder, deleteReminder],
};
