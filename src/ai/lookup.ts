import { callArguments, type ToolCall } from "./stream";
import { utf8Length, utf8Prefix } from "./text";
import { LIST_NOTES_TOOL, LIST_REMINDERS_TOOL, REVIEW_TODAY_TOOL } from "./tools";
import type { ChatContext } from "./types";

/** Leaves room for a model preamble and a truncation notice in a saved reply. */
const MAX_LOCAL_LOOKUP_BYTES = 12_000;
const ASK_FOR_MORE = "今天还做了什么？告诉我，我可以补进日报。";

/** What the lookups of one reply found: lists shown as they are, and records the model answers from. */
export interface LookupResult { local: string; sources: string }

/** Numbered lines; a note's own line breaks are indented under its number. */
function listing(title: string, empty: string, items: readonly string[]): string {
  if (items.length === 0) return `\n${empty}`;
  return `\n${title}：\n${items.map((text, index) => `${index + 1}. ${text.replace(/\n/g, "\n   ")}`).join("\n")}`;
}

function todayReport(today: readonly string[]): string {
  if (today.length === 0) return `今天还没有记录。还做了什么？告诉我，我可以补进日报。`;
  const report = today.map((line) => (line.startsWith("还没处理的提醒：") ? `- 待跟进：${line.slice("还没处理的提醒：".length)}` : `- ${line}`)).join("\n");
  return today.length <= 1 ? `${report}\n\n${ASK_FOR_MORE}` : report;
}

/**
 * Answers the lookup calls from the lists sent with the request. A plain lookup is shown as it is;
 * one with `synthesize` becomes a source for a second, read-only request.
 */
export function lookupResults(calls: readonly ToolCall[], context: Pick<ChatContext, "reminders" | "notes" | "today">): LookupResult {
  const result: LookupResult = { local: "", sources: "" };
  const outputs: ReadonlyArray<[string, () => string]> = [
    [LIST_REMINDERS_TOOL, () => listing("你的提醒", "你现在没有提醒。", context.reminders)],
    [LIST_NOTES_TOOL, () => listing("你的备忘", "你现在没有备忘。", context.notes)],
    [REVIEW_TODAY_TOOL, () => todayReport(context.today)],
  ];
  for (const [name, output] of outputs) {
    const args = calls.filter((call) => call.name === name).map(callArguments).find((value) => value !== null);
    if (!args) continue;
    const target = args.synthesize === true ? "sources" : "local";
    result[target] = `${result[target] ? `${result[target]}\n\n` : ""}${output().trim()}`;
  }
  return result;
}

/** Keeps a long local result small enough to save in chat history. */
export function clipLocalLookup(text: string): string {
  if (utf8Length(text) <= MAX_LOCAL_LOOKUP_BYTES) return text;
  const bounded = utf8Prefix(text, MAX_LOCAL_LOOKUP_BYTES);
  const lastBreak = bounded.lastIndexOf("\n");
  return `${lastBreak >= 0 ? bounded.slice(0, lastBreak) : bounded}\n\n内容太多，这里只展示前面的记录。可到对应面板查看全部。`;
}
