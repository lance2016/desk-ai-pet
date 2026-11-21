import { minutesOf } from "../../preferences/QuietPreferences";
import { addDays, dateKey } from "../../worklog/WorkLog";
import { dayLines, type GreetingFacts } from "../GreetingContent";
import { awayMinutes } from "../presence";
import type { Brief, Moment, Occasion } from "../types";

const MINUTE_MS = 60_000;
/** The user has to be at the computer this long into the night before the pet says anything. */
const NIGHT_ACTIVE_MS = 15 * MINUTE_MS;
/** A night ends here, whenever it starts. */
const NIGHT_END_MINUTES = 4 * 60;
const RETURN_GAP_MS = 2 * 60 * MINUTE_MS;

/** The night `now` falls in, named by the day it started on; null in the daytime. `start`: "HH:MM". */
export function nightOf(now: number, start: string): string | null {
  const date = new Date(now);
  const minute = date.getHours() * 60 + date.getMinutes();
  const from = minutesOf(start);
  if (from >= NIGHT_END_MINUTES) {
    if (minute >= from) return dateKey(now);
    return minute < NIGHT_END_MINUTES ? dateKey(addDays(now, -1)) : null;
  }
  return minute >= from && minute < NIGHT_END_MINUTES ? dateKey(now) : null;
}

/**
 * A line of care: the model says it with what the day held, when the user lets it;
 * otherwise, and whenever the model cannot answer, it is the same words every time.
 * `about`: what this moment adds to tell the model.
 */
function care(line: string, about: (moment: Moment) => string[]): (moment: Moment, day: GreetingFacts) => Brief {
  return (moment, day) => ({ facts: moment.settings.careByModel ? [...about(moment), ...dayLines(day, moment.now)] : [], fallback: line });
}

export const WELCOME_BACK: Occasion = {
  id: "welcome_back",
  title: "回来打招呼",
  eases: true,
  wording: "model",
  intent: "欢迎用户回到电脑前",
  due: ({ now, returned, settings, lastSaid }) =>
    settings.welcomeBack && returned && now - (lastSaid[WELCOME_BACK.id] ?? -Infinity) >= RETURN_GAP_MS ? { rightAway: true } : null,
  brief: care("回来啦，欢迎回来～", ({ now, leftAt }) => [leftAt === null ? "用户刚回到电脑前" : `用户离开了大约 ${awayMinutes(leftAt, now)} 分钟，刚回到电脑前`]),
};

export const LATE_NIGHT: Occasion = {
  id: "late_night",
  title: "深夜关心",
  eases: true,
  wording: "model",
  intent: "劝用户早点休息，像朋友随口一说，不要说教",
  due: ({ now, activeMs, settings }) => {
    if (!settings.night || activeMs === null || activeMs < NIGHT_ACTIVE_MS) return null;
    const night = nightOf(now, settings.nightTime);
    return night === null ? null : { subject: night, allowQuiet: settings.nightDuringQuiet };
  },
  brief: care("已经很晚啦，忙完这一点就休息吧。", () => ["已经是深夜，用户还在用电脑"]),
};

/** How long the user has been at it since a real break, or since the pet last said so: saying it starts the count over. */
function sinceBreak({ now, activeMs, lastSaid }: Moment): number | null {
  return activeMs === null ? null : Math.min(activeMs, now - (lastSaid[REST.id] ?? -Infinity));
}

export const REST: Occasion = {
  id: "rest",
  title: "休息一下",
  eases: true,
  wording: "model",
  intent: "提醒用户起来活动一下、歇歇眼睛，像朋友随口一说，不要说教",
  due: (moment) => {
    const used = sinceBreak(moment);
    return moment.settings.rest && used !== null && used >= moment.settings.restMinutes * MINUTE_MS ? {} : null;
  },
  brief: care("我想伸个懒腰，你也休息一下吧。", (moment) => {
    const used = sinceBreak(moment);
    return [used === null ? "用户已经连续用了很久电脑" : `用户已经连续用了 ${Math.round(used / MINUTE_MS)} 分钟电脑`];
  }),
};
