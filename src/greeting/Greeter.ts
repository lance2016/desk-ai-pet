import { isQuietAt, type QuietPreferences } from "../preferences/QuietPreferences";
import { factLines, templateGreeting, type GreetingFacts } from "./GreetingContent";
import { greetingDay, greetingDue, type GreetingKind, type GreetingRecord } from "./GreetingSchedule";

export interface GreeterDeps {
  loadQuiet(): QuietPreferences;
  loadRecord(): GreetingRecord;
  saveRecord(record: GreetingRecord): void;
  facts(now: number): Promise<GreetingFacts>;
  /** Asks the model for a greeting. Rejects when it is not available. */
  compose(kind: GreetingKind, lines: string[], now: number): Promise<string>;
  /**
   * Shows the greeting. `offerMove`: earlier reminders are still open, so the pet
   * offers to move them to today. Returns false when the pet may not speak up now.
   */
  greet(text: string, offerMove: boolean): boolean;
}

/** Says good morning and good night once a day each, in the character's own words when the model is available. */
export class Greeter {
  private busy = false;

  constructor(private readonly deps: GreeterDeps) {}

  /** Cheap enough to call every few seconds. */
  async check(now: number): Promise<void> {
    const { loadQuiet, loadRecord, saveRecord, facts, compose, greet } = this.deps;
    if (this.busy) return;
    const quiet = loadQuiet();
    if (isQuietAt(quiet, now)) return;
    const record = loadRecord();
    const kind = greetingDue(now, quiet.quietHours, record);
    if (!kind) return;
    this.busy = true;
    try {
      // Claimed before asking the model, so a slow or failed request never greets twice.
      saveRecord({ ...record, [kind]: greetingDay(now, quiet.quietHours) });
      const known = await facts(now);
      const text = await compose(kind, factLines(kind, known, now), now).catch((error: unknown) => {
        console.warn("Using the template greeting", error);
        return "";
      });
      const offerMove = kind === "morning" && known.leftovers.length > 0;
      // Held back (for example, the pet spoke up a moment ago): give the day back, so it greets later.
      if (!greet(text.trim() || templateGreeting(kind, known, now), offerMove)) saveRecord({ ...loadRecord(), [kind]: record[kind] });
    } finally {
      this.busy = false;
    }
  }
}
