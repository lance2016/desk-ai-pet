import { factLines, templateGreeting } from "../GreetingContent";
import { greetingDay, greetingDue, type GreetingKind } from "../GreetingSchedule";
import type { Occasion } from "../types";

/** Good morning waits until the user is at the computer; good night does not. Each is said once a day. */
function greeting(kind: GreetingKind, title: string, intent: string): Occasion {
  return {
    id: kind,
    title,
    wording: "model",
    intent,
    due: ({ now, activeMs, settings, quietHours }) => {
      if (greetingDue(now, quietHours, settings.morningTime) !== kind) return null;
      if (kind === "morning" && (!settings.morningGreeting || activeMs === null)) return null;
      return { subject: greetingDay(now, settings.morningTime) };
    },
    brief: ({ now }, day) => ({
      facts: factLines(kind, day, now),
      fallback: templateGreeting(kind, day, now),
      offerMove: kind === "morning" && day.leftovers.length > 0,
    }),
  };
}

export const MORNING = greeting("morning", "早安", "向用户问好，开始新的一天");
export const EVENING = greeting("evening", "晚安", "跟用户道晚安，收个尾");
