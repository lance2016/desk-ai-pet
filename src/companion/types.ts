import type { CompanionPreferences } from "../preferences/CompanionPreferences";
import type { QuietPreferences } from "../preferences/QuietPreferences";
import type { GreetingFacts } from "./GreetingContent";

/**
 * What the pet can tell about this moment without reading anything slow.
 * Plain data, so a test can make one up.
 */
export interface Moment {
  now: number;
  /**
   * How long the user has been at the computer without a real break. Null while
   * they are not using it right now, or when that cannot be told.
   */
  activeMs: number | null;
  /** True on the one check that finds the user back after a long time away. */
  returned: boolean;
  settings: CompanionPreferences;
  quietHours: QuietPreferences["quietHours"];
  /** When each occasion was last spoken for, by occasion id. */
  lastSaid: Readonly<Record<string, number>>;
}

/** An occasion found its moment. */
export interface Cue {
  /**
   * What the line is about, when the occasion must not come up twice for the
   * same thing: the day for a greeting, the night for late-night care.
   */
  subject?: string;
  /** Said even in quiet hours. "勿扰" still holds it back. */
  allowQuiet?: boolean;
}

/** What a line written by the model is made from. */
export interface Brief {
  /** What the pet knows, for the model to weave in. Data, never instructions. */
  facts: string[];
  /** Said as it is when the model cannot answer. */
  fallback: string;
  /** Earlier reminders are still open: also offer to move them to today. */
  offerMove?: boolean;
}

interface OccasionBase {
  id: string;
  /** What settings call it. */
  title: string;
  /**
   * Whether this is the moment. Checked every few seconds, so it reads nothing
   * slow and never asks the model.
   */
  due(moment: Moment): Cue | null;
}

/** A line that is always the same words. */
export interface FixedOccasion extends OccasionBase {
  wording: "fixed";
  line: string;
}

/** A line the model writes in the character's voice. */
export interface WrittenOccasion extends OccasionBase {
  wording: "model";
  /** What the line is for; it completes "请用一句…的话" in the request. */
  intent: string;
  /** Built only once the occasion is chosen, with what the pet knows about the user's day. */
  brief(moment: Moment, day: GreetingFacts): Brief;
}

/**
 * One reason for the pet to speak up by itself. A new one is a new entry in
 * `OCCASIONS`: when it is due, and what to say.
 */
export type Occasion = FixedOccasion | WrittenOccasion;

/** The line as it reaches the pet. */
export interface Line {
  text: string;
  allowQuiet: boolean;
  offerMove: boolean;
}
