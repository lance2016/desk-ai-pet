import { clockLabel, dueReminders, occurrenceAt, type AgendaItem } from "../../agenda/AgendaStore";
import { awayMinutes } from "../presence";
import type { Brief, Occasion } from "../types";

const MINUTE_MS = 60_000;
/** How long before a reminder the pet mentions it. */
const AHEAD_MS = 10 * MINUTE_MS;
/** Closer than this the reminder itself is about to come: nothing is said ahead of it. */
const TOO_CLOSE_MS = 2 * MINUTE_MS;
/** A reminder set this shortly before its time needs no word ahead: the user has just named the time. */
const JUST_SET_MS = 60 * MINUTE_MS;
/** The user left for a reminder when they went within this time of it. */
const LEFT_WITHIN_MS = 30 * MINUTE_MS;
/** Away longer than this, the user is not just back from it any more. */
const LONGEST_AWAY_MS = 4 * 60 * MINUTE_MS;
/** Shown by the preview when there is no reminder to speak of. */
const EXAMPLE = { ahead: "开会", left: "出去吃饭" };

/** A moved reminder is a new thing to speak of. */
const subjectOf = (item: AgendaItem) => `${item.id}@${item.remindAt}`;

/**
 * The one-off reminder to mention now, ahead of its time. Repeating ones are routine:
 * a word ahead every day would be noise.
 */
function comingUp(items: readonly AgendaItem[], now: number): AgendaItem | null {
  const close = items.filter((item) => {
    const wait = item.remindAt - now;
    return item.repeat === null && item.doneAt === null && wait <= AHEAD_MS && wait > TOO_CLOSE_MS && item.remindAt - item.createdAt >= JUST_SET_MS;
  });
  return close.reduce<AgendaItem | null>((first, item) => (first === null || item.remindAt < first.remindAt ? item : first), null);
}

const aheadLine = (text: string, minutes: number) => `还有 ${minutes} 分钟：${text}`;

export const HEADS_UP: Occasion = {
  id: "heads_up",
  title: "提醒前说一声",
  wording: "fixed",
  line: ({ reminders, now }) => {
    const item = comingUp(reminders, now);
    return item ? aheadLine(item.text, Math.round((item.remindAt - now) / MINUTE_MS)) : aheadLine(EXAMPLE.ahead, AHEAD_MS / MINUTE_MS);
  },
  due: ({ now, activeMs, settings, reminders }) => {
    if (!settings.headsUp || activeMs === null) return null;
    const item = comingUp(reminders, now);
    // The user timed the reminder, so the word ahead of it comes in quiet hours too, as the reminder does.
    return item ? { subject: subjectOf(item), allowQuiet: true, timedByUser: true } : null;
  },
};

/** The reminder as it stands now: a repeating one with `remindAt` moved to its latest time that has come. */
function latest(item: AgendaItem, now: number): AgendaItem | null {
  const at = occurrenceAt(item, now);
  return at === null ? null : { ...item, remindAt: at };
}

/** Shown or ticked off at `at`; for a repeating reminder only from its latest time on, not on an earlier day. */
const seenAt = (at: number | null, item: AgendaItem) => at !== null && (item.repeat === null || at >= item.remindAt);

/**
 * The reminder the user seems to have left for: it came up around the time they went, and they
 * saw to it (the pet showed it, or it is ticked off). One still waiting to be shown comes up by
 * itself when they are back. A repeating one counts by its latest time, with `remindAt` moved there.
 */
function leftFor(items: readonly AgendaItem[], leftAt: number, now: number): AgendaItem | null {
  if (now - leftAt > LONGEST_AWAY_MS) return null;
  const waiting = new Set(dueReminders(items, now).map((item) => item.id));
  const seenTo = items.filter((item) => !waiting.has(item.id)).flatMap((item) => latest(item, now) ?? [])
    .filter((item) => (seenAt(item.remindedAt, item) || seenAt(item.doneAt, item))
      && item.remindAt <= now && Math.abs(leftAt - item.remindAt) <= LEFT_WITHIN_MS);
  return seenTo.reduce<AgendaItem | null>((last, item) => (last === null || item.remindAt > last.remindAt ? item : last), null);
}

function askAfter(text: string, done: boolean, facts: string[]): Brief {
  return { facts, fallback: done ? `回来啦～「${text}」还顺利吗？` : `回来啦～「${text}」弄好了吗？` };
}

export const FOLLOW_UP: Occasion = {
  id: "follow_up",
  title: "回来问一句",
  eases: true,
  wording: "model",
  // Told only what the user went to do: a model that hears "提醒" or "没标完成" starts nagging about the reminder itself.
  intent: "在用户回到电脑前时，像朋友一样顺着他刚才去做的那件事随口问一句，不要提“提醒”这两个字",
  due: ({ now, leftAt, settings, reminders }) => {
    if (!settings.followUp || leftAt === null) return null;
    const item = leftFor(reminders, leftAt, now);
    return item ? { subject: subjectOf(item), rightAway: true } : null;
  },
  brief: ({ now, leftAt, reminders, settings }) => {
    const item = leftAt === null ? null : leftFor(reminders, leftAt, now);
    const written = (facts: string[]) => (settings.careByModel ? facts : []);
    if (item === null || leftAt === null) return askAfter(EXAMPLE.left, true, written([`用户刚才去做了这件事：「${EXAMPLE.left}」，已经做完`, "用户刚回到电脑前"]));
    const done = seenAt(item.doneAt, item);
    return askAfter(item.text, done, written([
      `用户 ${clockLabel(item.remindAt)} 去做了这件事：「${item.text}」，${done ? "已经做完" : "不知道做成没有"}`,
      `用户离开了大约 ${awayMinutes(leftAt, now)} 分钟，刚回到电脑前`,
    ]));
  },
};
