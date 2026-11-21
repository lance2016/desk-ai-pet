import type { WorkLogData } from "./WorkLog";

/** One day as the log tells it, after undoing what was undone the same day. */
export interface DayRecap {
  day: string;
  /** Reminders ticked off and not unticked again, by id, with their text when ticked. */
  remindersDone: Map<string, string>;
  /** Notes written or changed and not deleted afterwards, by id, with their latest text. */
  notesWritten: Map<string, string>;
  /** Reminders ticked off, also on folded days whose texts are gone. */
  doneCount: number;
  focusRounds: number;
  focusStopped: number;
  /** Long Claude Code turns finished, by project folder; folded days have only the total. */
  agentTurns: Map<string, number>;
  agentTurnCount: number;
}

/** Projects named after the count. */
const MAX_PROJECTS = 3;

/** What `log` says about `day`. */
export function dayRecap(log: WorkLogData, day: string): DayRecap {
  const remindersDone = new Map<string, string>();
  const notesWritten = new Map<string, string>();
  let focusRounds = 0;
  let focusStopped = 0;
  const agentTurns = new Map<string, number>();
  for (const { day: on, kind, text, itemId } of log.events) {
    if (on !== day) continue;
    if (kind === "focus_completed") focusRounds += 1;
    else if (kind === "focus_stopped") focusStopped += 1;
    else if (kind === "agent_turn_done") agentTurns.set(text, (agentTurns.get(text) ?? 0) + 1);
    if (itemId === null) continue;
    if (kind === "reminder_done") remindersDone.set(itemId, text);
    else if (kind === "reminder_undone") remindersDone.delete(itemId);
    else if (kind === "note_added" || kind === "note_edited") notesWritten.set(itemId, text);
    else if (kind === "note_deleted") notesWritten.delete(itemId);
  }
  const counted = (kind: string) => log.counts.filter((count) => count.day === day && count.kind === kind).reduce((sum, count) => sum + count.count, 0);
  return {
    day,
    remindersDone,
    notesWritten,
    doneCount: remindersDone.size + counted("reminder_done"),
    focusRounds: focusRounds + counted("focus_completed"),
    focusStopped: focusStopped + counted("focus_stopped"),
    agentTurns,
    agentTurnCount: [...agentTurns.values()].reduce((sum, count) => sum + count, 0) + counted("agent_turn_done"),
  };
}

/** "让 Claude Code 干完了 3 轮活：ai-pet 2 轮、robot 1 轮", or null without any. The caller puts the day before it. */
export function agentWork(recap: DayRecap): string | null {
  if (recap.agentTurnCount === 0) return null;
  const named = [...recap.agentTurns].sort((a, b) => b[1] - a[1]).slice(0, MAX_PROJECTS).map(([project, count]) => `${project} ${count} 轮`);
  return `让 Claude Code 干完了 ${recap.agentTurnCount} 轮活${named.length > 0 ? `：${named.join("、")}` : ""}`;
}

/** Whether the day has anything worth telling. */
export function hasNews(recap: DayRecap): boolean {
  return recap.doneCount > 0 || recap.notesWritten.size > 0 || recap.focusRounds > 0 || recap.agentTurnCount > 0;
}

/** The latest day in `log` before `today` with anything worth telling. */
export function lastActiveDay(log: WorkLogData, today: string): DayRecap | null {
  const days = [...new Set([...log.events.map((event) => event.day), ...log.counts.map((count) => count.day)])].filter((day) => day < today).sort().reverse();
  for (const day of days) {
    const recap = dayRecap(log, day);
    if (hasNews(recap)) return recap;
  }
  return null;
}
