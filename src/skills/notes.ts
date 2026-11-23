import type { Skill, Tool, ToolCall, ToolOutcome } from "../ai/skill";
import { loadSavedItems, readNoteCall, readText } from "../agenda/chatTools";
import { editNote, loadNotes, NOTE_LIMITS, removeNote, restoreNote, sortNotes, type Note } from "../notes/NoteStore";
import { changeNotes, keepNote } from "../worklog/store";
import { isOutcome, listTool, notChanged, notSaved, refParameter, textParameter, TRIMMED, undoLine, writing } from "./items";
import { itemId } from "./refs";

export const LIST_NOTES_TOOL = "list_notes";
export const SAVE_NOTE_TOOL = "save_note";
export const UPDATE_NOTE_TOOL = "update_note";
export const DELETE_NOTE_TOOL = "delete_note";

const REF = refParameter(LIST_NOTES_TOOL, "n2");

function putBack(before: Note): void {
  changeNotes((notes) => (notes.some((note) => note.id === before.id) ? notes.map((note) => (note.id === before.id ? before : note)) : restoreNote(notes, before)), "user");
}

function findNote(args: Record<string, unknown>, call: ToolCall): Note | ToolOutcome {
  if (typeof args.ref !== "string" || !args.ref.trim()) return notChanged("没说是哪一条备忘");
  const id = itemId(call, "note", args.ref);
  if (!id) return notChanged(`找不到编号 ${args.ref} 的备忘，先用 ${LIST_NOTES_TOOL} 查一下`);
  return loadNotes().find((note) => note.id === id) ?? notChanged("这条备忘已经不在了");
}

const listNotes = listTool(LIST_NOTES_TOOL, "查看备忘", "查看用户存的全部备忘。用户问起以前记下的东西，或要修改、删除备忘时使用，例：“WiFi 密码是多少”“我记过哪些要买的”。", "note", "你的备忘", "你现在没有备忘。", () => {
  const notes = sortNotes(loadSavedItems().notes);
  return { ids: notes.map((note) => note.id), texts: notes.map((note) => note.text) };
});

const saveNote: Tool = {
  name: SAVE_NOTE_TOOL,
  label: "保存备忘",
  description: "用户明确要求记录且未指定时间时，新建一条备忘，例如记下待办、地址或想法。保存结果由应用确认。",
  parameters: () => ({ type: "object", properties: { text: textParameter(`要保存的内容，保留用户给的原文和换行，不超过 ${NOTE_LIMITS.text} 字`) }, required: ["text"] }),
  run: (args) => writing(() => {
    const note = readNoteCall(args);
    if (!note) return notSaved("没看懂要存什么");
    const saved = keepNote(note.text, "chat");
    return { result: `已存进备忘：${saved.text}`, lines: [{ kind: "note", id: saved.id, text: `已存进备忘：${saved.text}${note.trimmed ? TRIMMED : ""}` }], confirmation: "好，存进备忘了" };
  }),
};

const updateNote: Tool = {
  name: UPDATE_NOTE_TOOL,
  label: "修改备忘",
  description: `改写一条已有的备忘。先用 ${LIST_NOTES_TOOL} 拿到编号。`,
  requires: [LIST_NOTES_TOOL],
  parameters: () => ({ type: "object", properties: { ref: REF, text: textParameter(`改写后的完整内容，不超过 ${NOTE_LIMITS.text} 字`) }, required: ["ref", "text"] }),
  run: (args, call) => writing(() => {
    const before = findNote(args, call);
    if (isOutcome(before)) return before;
    const text = typeof args.text === "string" ? readText(args.text, NOTE_LIMITS.text) : null;
    if (!text) return notChanged("没看懂要改成什么");
    changeNotes((notes) => editNote(notes, before.id, text.text, Date.now()), "chat");
    return {
      result: `已改好：${text.text}`,
      lines: [undoLine({ kind: "note", id: before.id, text: `已改备忘：${text.text}${text.trimmed ? TRIMMED : ""}` }, () => putBack(before))],
      confirmation: "好，备忘改好了",
    };
  }),
};

const deleteNote: Tool = {
  name: DELETE_NOTE_TOOL,
  label: "删除备忘",
  description: `删除一条已有的备忘。先用 ${LIST_NOTES_TOOL} 拿到编号。`,
  requires: [LIST_NOTES_TOOL],
  parameters: () => ({ type: "object", properties: { ref: REF }, required: ["ref"] }),
  run: (args, call) => writing(() => {
    const before = findNote(args, call);
    if (isOutcome(before)) return before;
    changeNotes((notes) => removeNote(notes, before.id), "chat");
    return {
      result: `已删除：${before.text}`,
      lines: [undoLine({ kind: "note", text: `已删除备忘：${before.text}` }, () => putBack(before))],
      confirmation: "好，删掉了这条备忘",
    };
  }),
};

/** Notes: things kept as they are, with no time. */
export const notesSkill: Skill = {
  id: "notes",
  title: "备忘",
  summary: "你说「记一下 WiFi 密码」时存进备忘，也能查、改和删除",
  rules: () => `用户明确要求记录、但没给日期或时间时，用 ${SAVE_NOTE_TOOL}；给了时间的是提醒，不存进备忘。每条新备忘都要实际调用工具，是否保存成功由应用确认。用户问起以前记下的东西时调用 ${LIST_NOTES_TOOL}，不要用聊天历史代替实际记录；直接查看清单时由应用展示结果，无需先说“我查一下”；要按条件找、需要归纳，或要修改、删除某条时设 synthesize=true。修改或删除备忘时，先用 ${LIST_NOTES_TOOL} 并设 synthesize=true 拿到编号，再用 ${UPDATE_NOTE_TOOL} 或 ${DELETE_NOTE_TOOL} 按编号处理；编号只在这次回复里有效。对不上或有几条都可能时，先问用户是哪一条，不要猜。`,
  tools: [listNotes, saveNote, updateNote, deleteNote],
};
