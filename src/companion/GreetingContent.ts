import { formatReminderTime, isDone, leftoverReminders, occurrenceAt, shownAt, type AgendaItem } from "../agenda/AgendaStore";
import { agentWork, dayRecap, lastActiveDay } from "../worklog/recap";
import { addDays, dateKey, type WorkLogData } from "../worklog/WorkLog";
import type { GreetingKind } from "./GreetingSchedule";

/** Reminders named in one fact line at most. */
const MAX_NAMED = 5;
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
/** How far back the morning looks for the last day the user did something. */
export const LOOK_BACK_DAYS = 7;

interface Reminder {
  text: string;
  at: number;
}

/** The last earlier day the user did something: what the morning picks up from. */
interface LastDay {
  /** "昨天", or the date when it was longer ago. */
  label: string;
  done: string[];
  doneCount: number;
  focusRounds: number;
  /** "让 Claude Code 干完了 3 轮活：…", or null. */
  agentWork: string | null;
}

/** What the pet knows about the user's day when it greets. */
export interface GreetingFacts {
  /** Reminders still to handle today: due today, or overdue and not done. Later days do not count. */
  openCount: number;
  doneToday: number;
  /** The next reminder still to come. */
  nextReminder: Reminder | null;
  /** The reminder the pet announced most recently today. */
  latestReminder: Reminder | null;
  focusToday: number;
  lastDay: LastDay | null;
  /** One-off reminders from earlier days still open; the morning offers to move them to today. */
  leftovers: Reminder[];
}

function dayLabel(day: string, now: number): string {
  if (day === dateKey(addDays(now, -1))) return "昨天";
  const [year, month, date] = day.split("-").map(Number);
  return `${month}月${date}日 周${WEEKDAYS[new Date(year, month - 1, date).getDay()]}`;
}

/** `log` covers the last `LOOK_BACK_DAYS` days and today. */
export function collectFacts(items: readonly AgendaItem[], log: WorkLogData, now: number): GreetingFacts {
  const today = dateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const open = items.filter((item) => !isDone(item, now));
  const dueToday = open.filter((item) => shownAt(item, now) < tomorrow.getTime());
  const upcoming = open.map((item) => ({ text: item.text, at: shownAt(item, now) })).filter((entry) => entry.at > now).sort((a, b) => a.at - b.at)[0];
  const announced = items.filter((item) => item.remindedAt !== null && dateKey(item.remindedAt) === today).sort((a, b) => (b.remindedAt ?? 0) - (a.remindedAt ?? 0))[0];
  const announcedAt = announced?.remindedAt ? occurrenceAt(announced, announced.remindedAt) : null;
  const last = lastActiveDay(log, today);
  return {
    openCount: dueToday.length,
    doneToday: items.filter((item) => item.doneAt !== null && dateKey(item.doneAt) === today).length,
    nextReminder: upcoming ?? null,
    latestReminder: announced && announcedAt !== null ? { text: announced.text, at: announcedAt } : null,
    focusToday: dayRecap(log, today).focusRounds,
    lastDay: last && { label: dayLabel(last.day, now), done: [...last.remindersDone.values()], doneCount: last.doneCount, focusRounds: last.focusRounds, agentWork: agentWork(last) },
    leftovers: leftoverReminders(items, now).sort((a, b) => a.remindAt - b.remindAt).map((item) => ({ text: item.text, at: item.remindAt })),
  };
}

const named = (texts: readonly string[]) => texts.slice(0, MAX_NAMED).join("、") + (texts.length > MAX_NAMED ? " 等" : "");

/** The facts as short lines for the model to weave into its greeting. */
export function factLines(kind: GreetingKind, facts: GreetingFacts, now: number): string[] {
  const reminder = (label: string, value: Reminder | null) => (value ? [`${label}：${formatReminderTime(value.at, now)} ${value.text}`] : []);
  if (kind === "morning") {
    const { lastDay, leftovers } = facts;
    return [
      `今天要处理的提醒 ${facts.openCount} 个`,
      ...reminder("下一个提醒", facts.nextReminder),
      ...(lastDay && lastDay.doneCount > 0 ? [`${lastDay.label}完成了 ${lastDay.doneCount} 个提醒${lastDay.done.length > 0 ? `：${named(lastDay.done)}` : ""}`] : []),
      ...(lastDay && lastDay.focusRounds > 0 ? [`${lastDay.label}专注了 ${lastDay.focusRounds} 轮`] : []),
      ...(lastDay?.agentWork ? [`${lastDay.label}${lastDay.agentWork}`] : []),
      ...(leftovers.length > 0 ? [`之前没做完的提醒 ${leftovers.length} 个：${named(leftovers.map((item) => `${formatReminderTime(item.at, now)} ${item.text}`))}`] : []),
    ];
  }
  return [`今天完成了 ${facts.doneToday} 个提醒，还有 ${facts.openCount} 个没处理`, `今天专注了 ${facts.focusToday} 轮`, ...reminder("最近一次提醒", facts.latestReminder)];
}

/** What today held so far, for a line of care to mention: only what there is something to say about. */
export function dayLines(facts: GreetingFacts, now: number): string[] {
  return [
    ...(facts.focusToday > 0 ? [`今天专注了 ${facts.focusToday} 轮`] : []),
    ...(facts.doneToday > 0 ? [`今天完成了 ${facts.doneToday} 个提醒`] : []),
    ...(facts.nextReminder ? [`下一个提醒：${formatReminderTime(facts.nextReminder.at, now)} ${facts.nextReminder.text}`] : []),
  ];
}

function hello(now: number): string {
  const hour = new Date(now).getHours();
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

/** A greeting written without the model, used when it is unavailable. */
export function templateGreeting(kind: GreetingKind, facts: GreetingFacts, now: number): string {
  if (kind === "morning") {
    if (facts.leftovers.length > 0) return `${hello(now)}！之前还有 ${facts.leftovers.length} 个提醒没做完，要挪到今天吗？`;
    if (facts.openCount === 0) return `${hello(now)}！今天也一起加油吧～`;
    const next = facts.nextReminder ? `，${formatReminderTime(facts.nextReminder.at, now)} 要${facts.nextReminder.text}` : "";
    return `${hello(now)}！今天有 ${facts.openCount} 个提醒${next}。`;
  }
  const parts = [
    ...(facts.focusToday > 0 ? [`今天专注了 ${facts.focusToday} 轮`] : []),
    ...(facts.doneToday > 0 ? [`完成了 ${facts.doneToday} 个提醒`] : []),
  ];
  return parts.length > 0 ? `晚上好～${parts.join("，")}，早点休息哦。` : "晚上好～今天辛苦啦，早点休息哦。";
}
