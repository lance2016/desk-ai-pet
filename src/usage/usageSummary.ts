import { addDays, dateKey, type WorkLogData } from "../worklog/WorkLog";
import { usageKind } from "./usage";

/** A line on the usage page and the work log kinds it adds up. `byPet`: started by the pet or an agent, not the user. */
export interface UsageRow { id: string; label: string; kinds: readonly string[]; byPet?: boolean }

/** In the order shown when counts are equal. Uses come first, then what the work log already kept. */
export const USAGE_ROWS: readonly UsageRow[] = [
  { id: "quick_chat", label: "快速聊天发消息", kinds: [usageKind("quick_chat")] },
  { id: "chat_send", label: "聊天窗口发消息", kinds: [usageKind("chat_send")] },
  { id: "greeting_reply", label: "回宠物主动说的话", kinds: [usageKind("greeting_reply")] },
  { id: "handed", label: "处理递给它的内容", kinds: [usageKind("handed")] },
  { id: "voice_input", label: "语音输入", kinds: [usageKind("voice_input")] },
  { id: "read_aloud", label: "朗读回复", kinds: [usageKind("read_aloud")] },
  { id: "petted", label: "摸摸头", kinds: [usageKind("petted")] },
  { id: "quick_action", label: "快捷按钮做动作", kinds: [usageKind("quick_action")] },
  { id: "panel_today", label: "打开提醒", kinds: [usageKind("panel_today")] },
  { id: "panel_notes", label: "打开备忘", kinds: [usageKind("panel_notes")] },
  { id: "panel_links", label: "打开常用链接", kinds: [usageKind("panel_links")] },
  { id: "panel_coding", label: "打开 Claude Code", kinds: [usageKind("panel_coding")] },
  { id: "panel_translation", label: "打开翻译窗口", kinds: [usageKind("panel_translation")] },
  { id: "link_open", label: "从常用链接打开网址", kinds: [usageKind("link_open")] },
  { id: "coding_reveal", label: "回到终端", kinds: [usageKind("coding_reveal")] },
  { id: "mail_code", label: "查收验证码", kinds: [usageKind("mail_code")] },
  { id: "dubbing", label: "打开配音", kinds: [usageKind("dubbing")] },
  { id: "reminder_added", label: "新建提醒", kinds: ["reminder_added"] },
  { id: "reminder_done", label: "完成提醒", kinds: ["reminder_done"] },
  { id: "note_added", label: "新建备忘", kinds: ["note_added"] },
  { id: "focus", label: "专注", kinds: ["focus_completed", "focus_stopped"] },
  { id: "fact_added", label: "记住关于你的事", kinds: ["fact_added"] },
  { id: "greeting", label: "宠物主动搭话", kinds: [usageKind("greeting")], byPet: true },
  { id: "agent_turn", label: "Claude Code 做完一轮", kinds: ["agent_turn_done"], byPet: true },
];

export const USAGE_DAYS = 30;
const WEEK_DAYS = 7;
const HOURS = 24;

export interface UsageLine { id: string; label: string; byPet: boolean; week: number; month: number }
export interface UsageSummary {
  /** Most used in the last 30 days first. */
  lines: readonly UsageLine[];
  /** The user's uses each day, oldest first, today last; the pet's own lines and agents left out. */
  days: readonly { day: string; count: number }[];
  /** The user's uses by hour of the day. Only days still kept in full have the time; older ones are counts. */
  hours: readonly number[];
  greetings: { said: number; answered: number };
  /** The first day a use was counted, or null before any. */
  since: string | null;
}

interface Tally { day: string; kind: string; count: number; at: number | null }

/** Adds up the work log of the last `USAGE_DAYS` days, today included. */
export function summarizeUsage(log: WorkLogData, now: number): UsageSummary {
  const days = Array.from({ length: USAGE_DAYS }, (_, index) => dateKey(addDays(now, index - USAGE_DAYS + 1)));
  const first = days[0];
  const weekFrom = days[USAGE_DAYS - WEEK_DAYS];
  const rowOf = new Map(USAGE_ROWS.flatMap((row) => row.kinds.map((kind) => [kind, row] as const)));
  const tallies: Tally[] = [
    ...log.events.map((event) => ({ day: event.day, kind: event.kind, count: 1, at: event.at })),
    ...log.counts.map((count) => ({ ...count, at: null })),
  ].filter((tally) => tally.day >= first && rowOf.has(tally.kind));

  const lines = USAGE_ROWS.map((row): UsageLine => {
    const own = tallies.filter((tally) => rowOf.get(tally.kind) === row);
    const sum = (from: string) => own.filter((tally) => tally.day >= from).reduce((total, tally) => total + tally.count, 0);
    return { id: row.id, label: row.label, byPet: row.byPet === true, week: sum(weekFrom), month: sum(first) };
  }).sort((a, b) => b.month - a.month);

  const userTallies = tallies.filter((tally) => rowOf.get(tally.kind)?.byPet !== true);
  const perDay = days.map((day) => ({ day, count: userTallies.filter((tally) => tally.day === day).reduce((total, tally) => total + tally.count, 0) }));
  const hours = Array.from({ length: HOURS }, (_, hour) => userTallies.filter((tally) => tally.at !== null && new Date(tally.at).getHours() === hour).length);

  const month = (id: string) => lines.find((line) => line.id === id)?.month ?? 0;
  const useDays = tallies.filter((tally) => tally.kind.startsWith("use_")).map((tally) => tally.day).sort();
  return {
    lines,
    days: perDay,
    hours,
    greetings: { said: month("greeting"), answered: month("greeting_reply") },
    since: useDays[0] ?? null,
  };
}
