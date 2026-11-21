import { alreadySaid, unanswered, type Said } from "./history";
import type { Cue, Moment, Occasion } from "./types";

export interface Pick {
  occasion: Occasion;
  cue: Cue;
}

const HOUR_MS = 60 * 60_000;
/** Care that went unanswered this many times in a row is said at most once in this long. Loose on purpose: most care gets no answer. */
const EASING = [{ after: 5, gapMs: 4 * HOUR_MS }, { after: 3, gapMs: 2 * HOUR_MS }];

/**
 * The one occasion to speak for now, if any. Earlier in the table wins. An
 * occasion already spoken for its subject, one that would cut into the user's
 * typing, or one that may not speak up right now, is passed over, so nothing is
 * written that would not be shown. So is everything but what the user timed while the user
 * asked for quiet, and care (`eases`) that came too soon after care nobody answered.
 * `maySpeak`: whether a line would get through; true as its argument asks about a line allowed in quiet hours.
 */
export function decide(occasions: readonly Occasion[], moment: Moment, history: readonly Said[], maySpeak: (allowQuiet: boolean) => boolean): Pick | null {
  const care = new Set(occasions.filter((occasion) => occasion.eases).map((occasion) => occasion.id));
  const ignored = unanswered(history, care);
  const gapMs = EASING.find((step) => ignored >= step.after)?.gapMs ?? 0;
  const lastCare = history.reduce((latest, said) => (care.has(said.occasion) ? Math.max(latest, said.at) : latest), -Infinity);
  for (const occasion of occasions) {
    const cue = occasion.due(moment);
    if (!cue) continue;
    if (moment.hushed && !cue.timedByUser) continue;
    if (occasion.eases && moment.now - lastCare < gapMs) continue;
    if (cue.subject !== undefined && alreadySaid(history, occasion.id, cue.subject)) continue;
    if (!cue.rightAway && !moment.paused) continue;
    if (!maySpeak(cue.allowQuiet ?? false)) continue;
    return { occasion, cue };
  }
  return null;
}
