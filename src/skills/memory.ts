import { failed, type EffectLine, type Skill, type Tool, type ToolCall, type ToolOutcome } from "../ai/skill";
import { addAgendaItem, AGENDA_LIMITS, editAgendaItem, isDone, itemSummary, loadAgenda, removeAgendaItem, restoreAgendaItem, setAgendaItemDone, type AgendaItem } from "../agenda/AgendaStore";
import { FALLBACK_REASONS, PAST_TOLERANCE_MS, parseLocalTime, readNoteCall, readReminderCall, readText, reminderConfirmation } from "../agenda/chatTools";
import { parseRepeat, type Repeat } from "../agenda/Repeat";
import { editNote, loadNotes, NOTE_LIMITS, removeNote, restoreNote, type Note } from "../notes/NoteStore";
import { changeNotes, changeReminders, keepNote } from "../worklog/store";
import { itemId } from "./refs";
import { LIST_NOTES_TOOL, LIST_REMINDERS_TOOL } from "./lookup";

export const ADD_REMINDER_TOOL = "add_reminder";
export const SAVE_NOTE_TOOL = "save_note";
export const UPDATE_REMINDER_TOOL = "update_reminder";
export const DELETE_REMINDER_TOOL = "delete_reminder";
export const COMPLETE_REMINDER_TOOL = "complete_reminder";
export const UPDATE_NOTE_TOOL = "update_note";
export const DELETE_NOTE_TOOL = "delete_note";

const TRIMMED = "（已截短）";
const NOT_SAVED = "有的没记上，看下面的说明";
const NOT_CHANGED = "有的没改成，看下面的说明";
const STORAGE_FULL = "提醒或备忘没能保存，删掉几条旧的提醒或备忘再试";
/** The repeat rule that turns a repeating reminder back into a one-off. */
const ONCE = "once";

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const notSaved = (reason: string) => failed(`这条没记上：${reason}。可以再说一次，或者自己在提醒、备忘里添加`, { confirmation: NOT_SAVED });
/** The model can fix these, e.g. by looking the list up first, so it reads them and goes on. */
const notChanged = (reason: string) => failed(`没改成：${reason}`, { confirmation: NOT_CHANGED, needsModel: true });

/** Runs a write; a full or unreadable store becomes a line for the user instead of breaking the reply. */
function writing(work: () => ToolOutcome): ToolOutcome {
  try { return work(); } catch (error) {
    console.error("Could not save what the reply asked for", error);
    return failed(STORAGE_FULL, { confirmation: NOT_SAVED });
  }
}

/** Puts a reminder back as it was: replaced if it is still there, restored if it was removed. Undo is the user's own doing. */
function putBackReminder(before: AgendaItem): void {
  changeReminders((items) => (items.some((item) => item.id === before.id) ? items.map((item) => (item.id === before.id ? before : item)) : restoreAgendaItem(items, before)), "user");
}

function putBackNote(before: Note): void {
  changeNotes((notes) => (notes.some((note) => note.id === before.id) ? notes.map((note) => (note.id === before.id ? before : note)) : restoreNote(notes, before)), "user");
}

const textParameter = (description: string) => ({ type: "string", description });
const REMIND_AT = "提醒时间，用户本地时间，格式 YYYY-MM-DD HH:mm，必须晚于现在。用户只说了钟点、而今天这个钟点已经过了，就用明天的。只说了日期没说钟点，用当天 09:00。重复提醒填第一次提醒的时间";
const REPEAT = "重复规则，只提醒一次就省略。只支持三种：每个工作日（按中国法定节假日和调休）填 workdays；每天填 daily；每周固定几天填星期数字，用英文逗号分隔，1 是周一，7 是周日，如 1,3,5。每月、每年、隔周、每隔几天等其他规则都不支持，不要调用，如实告诉用户做不到";

const addReminder: Tool = {
  name: ADD_REMINDER_TOOL,
  description: "用户明确要提醒或记录某事，且给出日期、钟点或相对时间时，新建一条未来提醒。单纯聊到一个日期或时间不调用。保存结果由应用确认。",
  parameters: () => ({
    type: "object",
    properties: { text: textParameter(`要提醒的事，简短，不超过 ${AGENDA_LIMITS.text} 字，不含时间`), remind_at: textParameter(REMIND_AT), repeat: textParameter(REPEAT) },
    required: ["text", "remind_at"],
  }),
  run: (args) => writing(() => {
    const now = Date.now();
    const request = readReminderCall(args, now, newId);
    if (request.kind === "failed") return notSaved(request.reason);
    if (request.kind === "note") {
      const reason = FALLBACK_REASONS[request.note.fallback ?? "no-time"];
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

const saveNoteTool: Tool = {
  name: SAVE_NOTE_TOOL,
  description: "用户明确要求记录且未指定时间时，新建一条备忘，例如记下待办、地址或想法。保存结果由应用确认。",
  parameters: () => ({ type: "object", properties: { text: textParameter(`要保存的内容，保留用户给的原文和换行，不超过 ${NOTE_LIMITS.text} 字`) }, required: ["text"] }),
  run: (args) => writing(() => {
    const note = readNoteCall(args);
    if (!note) return notSaved("没看懂要存什么");
    const saved = keepNote(note.text, "chat");
    return { result: `已存进备忘：${saved.text}`, lines: [{ kind: "note", id: saved.id, text: `已存进备忘：${saved.text}${note.trimmed ? TRIMMED : ""}` }], confirmation: "好，存进备忘了" };
  }),
};

const REF = (list: string) => textParameter(`${list} 给的编号，如 ${list === LIST_REMINDERS_TOOL ? "r2" : "n2"}`);

function findReminder(args: Record<string, unknown>, call: ToolCall): AgendaItem | ToolOutcome {
  if (typeof args.ref !== "string" || !args.ref.trim()) return notChanged("没说是哪一条提醒");
  const id = itemId(call, "reminder", args.ref);
  if (!id) return notChanged(`找不到编号 ${args.ref} 的提醒，先用 ${LIST_REMINDERS_TOOL} 查一下`);
  return loadAgenda().find((item) => item.id === id) ?? notChanged("这条提醒已经不在了");
}

function findNote(args: Record<string, unknown>, call: ToolCall): Note | ToolOutcome {
  if (typeof args.ref !== "string" || !args.ref.trim()) return notChanged("没说是哪一条备忘");
  const id = itemId(call, "note", args.ref);
  if (!id) return notChanged(`找不到编号 ${args.ref} 的备忘，先用 ${LIST_NOTES_TOOL} 查一下`);
  return loadNotes().find((note) => note.id === id) ?? notChanged("这条备忘已经不在了");
}

const isOutcome = (value: object): value is ToolOutcome => "result" in value;
const undoLine = (line: Omit<EffectLine, "undo">, undo: () => void): EffectLine => ({ ...line, undo });

/** The changed repeat rule, null for a one-off, or undefined when the model asked for one the app cannot keep. */
function changedRepeat(value: unknown, current: Repeat | null): Repeat | null | undefined {
  if (typeof value !== "string" || !value.trim()) return current;
  return value.trim() === ONCE ? null : parseRepeat(value) ?? undefined;
}

const updateReminder: Tool = {
  name: UPDATE_REMINDER_TOOL,
  description: `修改一条已有的提醒：文字、时间或重复规则。先用 ${LIST_REMINDERS_TOOL} 拿到编号。只填要改的项。`,
  parameters: () => ({
    type: "object",
    properties: {
      ref: REF(LIST_REMINDERS_TOOL),
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
      lines: [undoLine({ kind: "agenda", id: after.id, text: `已改提醒：${summary}${text?.trimmed ? TRIMMED : ""}` }, () => putBackReminder(before))],
      confirmation: `好，改好了：${summary}`,
    };
  }),
};

const deleteReminder: Tool = {
  name: DELETE_REMINDER_TOOL,
  description: `删除一条已有的提醒。先用 ${LIST_REMINDERS_TOOL} 拿到编号。用户只是说做完了，用 ${COMPLETE_REMINDER_TOOL}，不要删除。`,
  parameters: () => ({ type: "object", properties: { ref: REF(LIST_REMINDERS_TOOL) }, required: ["ref"] }),
  run: (args, call) => writing(() => {
    const before = findReminder(args, call);
    if (isOutcome(before)) return before;
    changeReminders((items) => removeAgendaItem(items, before.id), "chat");
    const summary = itemSummary(before, Date.now());
    return {
      result: `已删除：${summary}`,
      lines: [undoLine({ kind: "agenda", text: `已删除提醒：${summary}` }, () => putBackReminder(before))],
      confirmation: `好，删掉了：${before.text}`,
    };
  }),
};

const completeReminder: Tool = {
  name: COMPLETE_REMINDER_TOOL,
  description: `用户说某条提醒的事做完了时，把它标记为完成，和在提醒面板里点「完成」一样；重复提醒只勾掉这一次。先用 ${LIST_REMINDERS_TOOL} 拿到编号。`,
  parameters: () => ({ type: "object", properties: { ref: REF(LIST_REMINDERS_TOOL) }, required: ["ref"] }),
  run: (args, call) => writing(() => {
    const before = findReminder(args, call);
    if (isOutcome(before)) return before;
    const now = Date.now();
    if (isDone(before, now)) return { result: `这条本来就是完成的：${before.text}`, confirmation: "这条已经勾掉了" };
    changeReminders((items) => setAgendaItemDone(items, before.id, true, now), "chat");
    return {
      result: `已完成：${before.text}`,
      lines: [undoLine({ kind: "agenda", id: before.id, text: `已完成提醒：${before.text}` }, () => putBackReminder(before))],
      confirmation: `好，「${before.text}」勾掉了`,
    };
  }),
};

const updateNote: Tool = {
  name: UPDATE_NOTE_TOOL,
  description: `改写一条已有的备忘。先用 ${LIST_NOTES_TOOL} 拿到编号。`,
  parameters: () => ({ type: "object", properties: { ref: REF(LIST_NOTES_TOOL), text: textParameter(`改写后的完整内容，不超过 ${NOTE_LIMITS.text} 字`) }, required: ["ref", "text"] }),
  run: (args, call) => writing(() => {
    const before = findNote(args, call);
    if (isOutcome(before)) return before;
    const text = typeof args.text === "string" ? readText(args.text, NOTE_LIMITS.text) : null;
    if (!text) return notChanged("没看懂要改成什么");
    changeNotes((notes) => editNote(notes, before.id, text.text, Date.now()), "chat");
    return {
      result: `已改好：${text.text}`,
      lines: [undoLine({ kind: "note", id: before.id, text: `已改备忘：${text.text}${text.trimmed ? TRIMMED : ""}` }, () => putBackNote(before))],
      confirmation: "好，备忘改好了",
    };
  }),
};

const deleteNote: Tool = {
  name: DELETE_NOTE_TOOL,
  description: `删除一条已有的备忘。先用 ${LIST_NOTES_TOOL} 拿到编号。`,
  parameters: () => ({ type: "object", properties: { ref: REF(LIST_NOTES_TOOL) }, required: ["ref"] }),
  run: (args, call) => writing(() => {
    const before = findNote(args, call);
    if (isOutcome(before)) return before;
    changeNotes((notes) => removeNote(notes, before.id), "chat");
    return {
      result: `已删除：${before.text}`,
      lines: [undoLine({ kind: "note", text: `已删除备忘：${before.text}` }, () => putBackNote(before))],
      confirmation: "好，删掉了这条备忘",
    };
  }),
};

/** Keeping reminders (with a time) and notes (without), and changing or removing them. */
export const memorySkill: Skill = {
  id: "memory",
  title: "记提醒和备忘",
  rules: () => `用户明确要求记录或提醒时，有日期或时间用 ${ADD_REMINDER_TOOL}，无时间用 ${SAVE_NOTE_TOOL}。提醒必须在未来：只给钟点且今天已过，就用明天；只给日期就用当地当天 09:00。指定每天、每个工作日或每周几时按工具说明填写 repeat；其他重复规则如实说明无法设置，不要擅自改成一次性提醒，也不要承诺以后帮忙续上；可以问用户要不要先只设下一次。每条新记录都要实际调用工具，是否保存成功、何时提醒由应用确认。聊天里出现日期，不代表用户要记录。修改或删除已有的提醒、备忘时，先用 ${LIST_REMINDERS_TOOL} 或 ${LIST_NOTES_TOOL} 并设 synthesize=true 拿到编号，再用 ${UPDATE_REMINDER_TOOL}、${DELETE_REMINDER_TOOL}、${UPDATE_NOTE_TOOL}、${DELETE_NOTE_TOOL} 按编号处理；用户说某件事做完了，同样先查编号，再用 ${COMPLETE_REMINDER_TOOL} 勾掉，不要删除；编号只在这次回复里有效。对不上或有几条都可能时，先问用户是哪一条，不要猜。`,
  tools: [addReminder, saveNoteTool, updateReminder, completeReminder, deleteReminder, updateNote, deleteNote],
};
