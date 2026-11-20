import type { CompanionPreferences } from "../preferences/CompanionPreferences";
import type { QuietPreferences } from "../preferences/QuietPreferences";
import type { GreetingFacts } from "./GreetingContent";
import { lastSaid, loadHistory, recordSaid } from "./history";
import { OCCASIONS } from "./occasions";
import { Presence, type PresenceSample } from "./presence";
import { decide } from "./schedule";
import type { Line, Moment, Occasion } from "./types";

/** Everything the companion needs from the rest of the app. */
export interface CompanionPorts {
  settings(): CompanionPreferences;
  quietHours(): QuietPreferences["quietHours"];
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

const NOT_HERE: PresenceSample = { activeMs: null, returned: false };

/** Decides when the pet speaks up by itself and what it says: one line at a time, from the table of occasions. */
export class Companion {
  private readonly presence = new Presence();
  private writing = false;

  constructor(private readonly ports: CompanionPorts, private readonly occasions: readonly Occasion[] = OCCASIONS) {}

  /** Cheap enough to call every few seconds. `idleSeconds`: how long the keyboard and mouse have been still, null when not known. */
  async check(now: number, idleSeconds: number | null): Promise<void> {
    // Sampled on every check, also while a line is being written, or the session would look interrupted.
    const sample = this.presence.sample(now, idleSeconds);
    if (this.writing) return;
    const history = loadHistory(this.ports.storage);
    const moment: Moment = { now, ...sample, settings: this.ports.settings(), quietHours: this.ports.quietHours(), lastSaid: lastSaid(history) };
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

  /** Says one occasion's line now, whether or not it is due, and leaves the history alone. Returns false when it could not be shown. */
  async test(id: string, now: number): Promise<boolean> {
    const occasion = this.occasions.find((entry) => entry.id === id);
    if (!occasion || this.writing) return false;
    this.writing = true;
    try {
      const moment: Moment = { now, ...NOT_HERE, settings: this.ports.settings(), quietHours: this.ports.quietHours(), lastSaid: {} };
      return this.ports.show((await this.compose(occasion, moment)).text);
    } finally {
      this.writing = false;
    }
  }

  private async compose(occasion: Occasion, moment: Moment): Promise<Omit<Line, "allowQuiet">> {
    if (occasion.wording === "fixed") return { text: occasion.line, offerMove: false };
    const brief = occasion.brief(moment, await this.ports.day(moment.now));
    const written = await this.ports.write(occasion.intent, brief.facts, moment.now).catch((error: unknown) => {
      console.warn(`Using the fallback line for ${occasion.id}`, error);
      return "";
    });
    return { text: written.trim() || brief.fallback, offerMove: brief.offerMove ?? false };
  }
}
