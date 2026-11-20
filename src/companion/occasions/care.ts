import { minutesOf } from "../../preferences/QuietPreferences";
import { addDays, dateKey } from "../../worklog/WorkLog";
import type { Occasion } from "../types";

/** The user has to be at the computer this long into the night before the pet says anything. */
const NIGHT_ACTIVE_MS = 15 * 60_000;
/** A night ends here, whenever it starts. */
const NIGHT_END_MINUTES = 4 * 60;
const RETURN_GAP_MS = 2 * 60 * 60_000;

/** The night `now` falls in, named by the day it started on; null in the daytime. `start`: "HH:MM". */
function nightOf(now: number, start: string): string | null {
  const date = new Date(now);
  const minute = date.getHours() * 60 + date.getMinutes();
  const from = minutesOf(start);
  if (from >= NIGHT_END_MINUTES) {
    if (minute >= from) return dateKey(now);
    return minute < NIGHT_END_MINUTES ? dateKey(addDays(now, -1)) : null;
  }
  return minute >= from && minute < NIGHT_END_MINUTES ? dateKey(now) : null;
}

export const WELCOME_BACK: Occasion = {
  id: "welcome_back",
  title: "回来打招呼",
  wording: "fixed",
  line: "回来啦，欢迎回来～",
  due: ({ now, returned, settings, lastSaid }) =>
    settings.welcomeBack && returned && now - (lastSaid[WELCOME_BACK.id] ?? -Infinity) >= RETURN_GAP_MS ? {} : null,
};

export const LATE_NIGHT: Occasion = {
  id: "late_night",
  title: "深夜关心",
  wording: "fixed",
  line: "已经很晚啦，忙完这一点就休息吧。",
  due: ({ now, activeMs, settings }) => {
    if (!settings.night || activeMs === null || activeMs < NIGHT_ACTIVE_MS) return null;
    const night = nightOf(now, settings.nightTime);
    return night === null ? null : { subject: night, allowQuiet: settings.nightDuringQuiet };
  },
};

export const REST: Occasion = {
  id: "rest",
  title: "休息一下",
  wording: "fixed",
  line: "我想伸个懒腰，你也休息一下吧。",
  due: ({ now, activeMs, settings, lastSaid }) => {
    if (!settings.rest || activeMs === null) return null;
    // Saying it starts the count over, like a real break does.
    const sinceBreak = Math.min(activeMs, now - (lastSaid[REST.id] ?? -Infinity));
    return sinceBreak >= settings.restMinutes * 60_000 ? {} : null;
  },
};
