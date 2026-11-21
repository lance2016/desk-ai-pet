import type { AgendaItem } from "../agenda/AgendaStore";
import type { CompanionPreferences } from "../preferences/CompanionPreferences";
import type { QuietPreferences } from "../preferences/QuietPreferences";
import type { Mood } from "../types";
import type { GreetingFacts } from "./GreetingContent";
import { lastSaid, loadHistory, markAnswered, recordSaid } from "./history";
import { hushedUntil } from "./hush";
import { moodLine, moodOf } from "./mood";
import { OCCASIONS } from "./occasions";
import { LATE_NIGHT, nightOf } from "./occasions/care";
import { Presence, type PresenceSample } from "./presence";
import { decide } from "./schedule";
import type { Line, Moment, Occasion } from "./types";

/** Everything the companion needs from the rest of the app. */
export interface CompanionPorts {
  settings(): CompanionPreferences;
  quietHours(): QuietPreferences["quietHours"];
  /** The user's reminders, from memory: asked for on every check. */
  reminders(): readonly AgendaItem[];
  /** Where the history of what was said is kept. */
  storage: Storage;
  /** Whether a line would be shown right now. `allowQuiet`: the line is one that is said in quiet hours too. */
  maySpeak(allowQuiet: boolean): boolean;
  /** What the pet knows about the user's day. */
  day(now: number): Promise<GreetingFacts>;
  /** Asks the model for a line. Rejects when it is not available. */
  write(intent: string, facts: string[], now: number): Promise<string>;
  /** Shows the line. Returns false when the pet may not speak up after all. */
  say(line: Line): boolean;
  /** Shows a line the user asked to see. Returns false when it cannot be shown. */
  show(text: string): boolean;
}

const NOT_HERE: PresenceSample = { activeMs: null, returned: false, leftAt: null };
/** The keyboard and mouse still for this long: the user is between two thoughts, not in the middle of a word. */
const PAUSE_SECONDS = 3;

/** Decides when the pet speaks up by itself and what it says: one line at a time, from the table of occasions. */
export class Companion {
  private readonly presence = new Presence();
  private writing = false;
  /** Whether the last check found the user at the computer. */
  private here = false;

  constructor(private readonly ports: CompanionPorts, private readonly occasions: readonly Occasion[] = OCCASIONS) {}

  /** Cheap enough to call every few seconds. `idleSeconds`: how long the keyboard and mouse have been still, null when not known. */
  async check(now: number, idleSeconds: number | null): Promise<void> {
    // Sampled on every check, also while a line is being written, or the session would look interrupted.
    const sample = this.presence.sample(now, idleSeconds);
    this.here = sample.activeMs !== null;
    if (this.writing) return;
    const history = loadHistory(this.ports.storage);
    const moment: Moment = { now, ...sample, paused: idleSeconds === null || idleSeconds >= PAUSE_SECONDS, hushed: hushedUntil(now, this.ports.storage) !== null, reminders: this.ports.reminders(), settings: this.ports.settings(), quietHours: this.ports.quietHours(), lastSaid: lastSaid(history) };
    const pick = decide(this.occasions, moment, history, (allowQuiet) => this.ports.maySpeak(allowQuiet));
    if (!pick) return;
    this.writing = true;
    try {
      const { occasion, cue } = pick;
      const line = await this.compose(occasion, moment);
      // Recorded only once shown: a line held back at the last moment comes up again later.
      if (this.ports.say({ ...line, allowQuiet: cue.allowQuiet ?? false })) {
        recordSaid({ occasion: occasion.id, subject: cue.subject ?? null, at: now }, this.ports.storage);
      }
    } finally {
      this.writing = false;
    }
  }

  /**
   * The user reacted to the pet: a pat, or opening the chat to answer. Soon after a line it counts as
   * an answer to it, so care is not taken for ignored. Returns whether it did.
   */
  heard(now: number): boolean {
    return markAnswered(now, this.ports.storage);
  }

  /** How the pet feels right now, from what the user's day held and whether they are up late. */
  async mood(now: number): Promise<Mood> {
    return this.feeling(now, await this.ports.day(now));
  }

  private feeling(now: number, day: GreetingFacts): Mood {
    const upLateNow = this.here && nightOf(now, this.ports.settings().nightTime) !== null;
    return moodOf(day, now, { upLateNow, lateCareAt: lastSaid(loadHistory(this.ports.storage))[LATE_NIGHT.id] });
  }

  /** Says one occasion's line now, whether or not it is due, and leaves the history alone. Returns false when it could not be shown. */
  async test(id: string, now: number): Promise<boolean> {
    const occasion = this.occasions.find((entry) => entry.id === id);
    if (!occasion || this.writing) return false;
    this.writing = true;
    try {
      const moment: Moment = { now, ...NOT_HERE, paused: true, hushed: false, reminders: this.ports.reminders(), settings: this.ports.settings(), quietHours: this.ports.quietHours(), lastSaid: {} };
      return this.ports.show((await this.compose(occasion, moment)).text);
    } finally {
      this.writing = false;
    }
  }

  private async compose(occasion: Occasion, moment: Moment): Promise<Omit<Line, "allowQuiet">> {
    if (occasion.wording === "fixed") return { text: typeof occasion.line === "string" ? occasion.line : occasion.line(moment), offerMove: false };
    const day = await this.ports.day(moment.now);
    const brief = occasion.brief(moment, day);
    if (brief.facts.length === 0) return { text: brief.fallback, offerMove: false };
    const facts = [...brief.facts, ...moodLine(this.feeling(moment.now, day))];
    const written = await this.ports.write(occasion.intent, facts, moment.now).catch((error: unknown) => {
      console.warn(`Using the fallback line for ${occasion.id}`, error);
      return "";
    });
    return { text: written.trim() || brief.fallback, offerMove: brief.offerMove ?? false };
  }
}
