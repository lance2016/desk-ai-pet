import type { ActivityUpdate, StatusChip } from "../types";

interface Entry {
  update: ActivityUpdate;
  /** The user clicked its line away. */
  seen: boolean;
}

const ongoing = (update: ActivityUpdate) => update.state === "running" || update.state === "waiting";

const sameReport = (a: ActivityUpdate, b: ActivityUpdate) =>
  a.state === b.state && a.label === b.label && a.text === b.text && a.icon === b.icon && (a.cancellable ?? false) === (b.cancellable ?? false)
  && (a.noChip ?? false) === (b.noChip ?? false) && a.opens === b.opens && (a.keep ?? false) === (b.keep ?? false);

/**
 * The things going on that the pet shows: a chip at its feet while one runs or
 * waits for the user, and a standing line when one waits for the user or failed.
 * A success is only said in passing (the engine says it), so it is not kept, unless
 * the user still needs it (`keep`, a code to type); due reminders stand ahead of it.
 * It only keeps track; the engine decides how the pet reacts.
 */
export class ActivityBoard {
  private entries: Entry[] = [];

  /** Takes a report. Returns false for one that changes nothing, so the user is not called twice for it. */
  report(update: ActivityUpdate): boolean {
    const before = this.entries.find((entry) => entry.update.id === update.id);
    if (before ? sameReport(before.update, update) : update.state === "cancelled") return false;
    // Over with nothing to tell, or done (said in passing): nothing is left to show.
    const stands = (update.state === "failed" || (update.state === "done" && update.keep)) && update.text;
    const kept: Entry[] = ongoing(update) || stands ? [{ update, seen: false }] : [];
    this.entries = before ? this.entries.flatMap((entry) => entry === before ? kept : [entry]) : [...this.entries, ...kept];
    return true;
  }

  /** One chip for each activity still going, oldest first; none for those shown somewhere of their own. */
  chips(): StatusChip[] {
    return this.entries.filter((entry) => ongoing(entry.update) && !entry.update.noChip).map(({ update }) => ({
      id: "activity",
      label: update.label,
      activity: { id: update.id, waiting: update.state === "waiting", cancellable: update.cancellable ?? false },
    }));
  }

  /** Whether an activity with this icon is running: the engine reacts to the first one starting, not to each. */
  running(icon: ActivityUpdate["icon"]): boolean {
    return this.entries.some((entry) => entry.update.state === "running" && entry.update.icon === icon);
  }

  /** The activity whose line should stand now: one waiting for the user first, then failures, oldest first. */
  notice(): ActivityUpdate | null {
    const open = this.notices();
    return (open.find((entry) => entry.update.state === "waiting") ?? open[0])?.update ?? null;
  }

  /** How many activities have a line to stand: the one `notice` gives and those behind it. */
  noticeCount(): number {
    return this.notices().length;
  }

  private notices(): Entry[] {
    return this.entries.filter((entry) => !entry.seen && entry.update.text && entry.update.state !== "running");
  }

  /** The user clicked the standing line away. A result is forgotten; an activity still waiting keeps its chip. */
  dismiss(): void {
    const top = this.notice();
    if (top === null) return;
    this.entries = this.entries.flatMap((entry) => entry.update !== top ? [entry] : ongoing(top) ? [{ ...entry, seen: true }] : []);
  }
}
