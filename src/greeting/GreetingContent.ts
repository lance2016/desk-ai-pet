import { formatReminderTime, isDone, occurrenceAt, shownAt, type AgendaItem } from "../agenda/AgendaStore";
import { FOCUS_CONFIG } from "../behavior/FocusTimer";
import { dateKey, focusRounds, type FocusLog } from "./FocusLog";
import type { GreetingKind } from "./GreetingSchedule";

const DAY_MS = 24 * 60 * 60_000;

interface Reminder {
  text: string;
  at: number;
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
  focusYesterday: number;
}

export function collectFacts(items: readonly AgendaItem[], log: FocusLog, now: number): GreetingFacts {
  const today = dateKey(now);
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const open = items.filter((item) => !isDone(item, now));
  const dueToday = open.filter((item) => shownAt(item, now) < tomorrow.getTime());
  const upcoming = open.map((item) => ({ text: item.text, at: shownAt(item, now) })).filter((entry) => entry.at > now).sort((a, b) => a.at - b.at)[0];
  const announced = items.filter((item) => item.remindedAt !== null && dateKey(item.remindedAt) === today).sort((a, b) => (b.remindedAt ?? 0) - (a.remindedAt ?? 0))[0];
  const announcedAt = announced?.remindedAt ? occurrenceAt(announced, announced.remindedAt) : null;
  return {
    openCount: dueToday.length,
    doneToday: items.filter((item) => item.doneAt !== null && dateKey(item.doneAt) === today).length,
    nextReminder: upcoming ?? null,
    latestReminder: announced && announcedAt !== null ? { text: announced.text, at: announcedAt } : null,
    focusToday: focusRounds(log, now),
    focusYesterday: focusRounds(log, now - DAY_MS),
  };
}

/** The facts as short lines for the model to weave into its greeting. */
export function factLines(kind: GreetingKind, facts: GreetingFacts, now: number): string[] {
  const round = `每轮 ${FOCUS_CONFIG.focusMs / 60_000} 分钟`;
  const reminder = (label: string, value: Reminder | null) => (value ? [`${label}：${formatReminderTime(value.at, now)} ${value.text}`] : []);
  if (kind === "morning") {
    return [`今天要处理的提醒 ${facts.openCount} 个`, ...reminder("下一个提醒", facts.nextReminder), `昨天专注了 ${facts.focusYesterday} 轮，${round}`];
  }
  return [`今天完成了 ${facts.doneToday} 个提醒，还有 ${facts.openCount} 个没处理`, `今天专注了 ${facts.focusToday} 轮，${round}`, ...reminder("最近一次提醒", facts.latestReminder)];
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
