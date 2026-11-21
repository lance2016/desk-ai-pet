import type { Mood } from "../types";
import type { GreetingFacts } from "./GreetingContent";

/** Focus rounds and reminders done today that put the pet in a bright mood. */
const BRIGHT_FROM = 3;
/** The pet is still tired this long after it told the user off for staying up. */
const TIRED_AFTER_LATE_MS = 12 * 60 * 60_000;

/** What shows the user is up late. */
export interface LateSigns {
  /** It is night now and the user is at the computer. */
  upLateNow: boolean;
  /** When the pet last said its late-night line, if it did. */
  lateCareAt: number | undefined;
}

/**
 * How the pet feels, worked out from the user's day rather than kept as a number:
 * tired when the user stays up late (and the morning after), bright when a few things got done.
 */
export function moodOf(day: Pick<GreetingFacts, "focusToday" | "doneToday">, now: number, late: LateSigns): Mood {
  if (late.upLateNow || (late.lateCareAt !== undefined && now - late.lateCareAt < TIRED_AFTER_LATE_MS)) return "tired";
  return day.focusToday + day.doneToday >= BRIGHT_FROM ? "bright" : "calm";
}

/** The mood as a line for the model writing what the pet says; nothing on an ordinary day. */
export function moodLine(mood: Mood): string[] {
  if (mood === "bright") return ["你今天心情很好，因为用户今天做成了不少事"];
  if (mood === "tired") return ["你有点困了，因为用户熬夜，你一直陪着"];
  return [];
}
