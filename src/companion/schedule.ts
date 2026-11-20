import { alreadySaid, type Said } from "./history";
import type { Cue, Moment, Occasion } from "./types";

export interface Pick {
  occasion: Occasion;
  cue: Cue;
}

/**
 * The one occasion to speak for now, if any. Earlier in the table wins. An
 * occasion already spoken for its subject, one that would cut into the user's
 * typing, or one that may not speak up right now, is passed over, so nothing is
 * written that would not be shown.
 * `maySpeak`: whether a line would get through; true as its argument asks about a line allowed in quiet hours.
 */
export function decide(occasions: readonly Occasion[], moment: Moment, history: readonly Said[], maySpeak: (allowQuiet: boolean) => boolean): Pick | null {
  for (const occasion of occasions) {
    const cue = occasion.due(moment);
    if (!cue) continue;
    if (cue.subject !== undefined && alreadySaid(history, occasion.id, cue.subject)) continue;
    if (!cue.rightAway && !moment.paused) continue;
    if (!maySpeak(cue.allowQuiet ?? false)) continue;
    return { occasion, cue };
  }
  return null;
}
