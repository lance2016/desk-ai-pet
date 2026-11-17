export const FOCUS_CONFIG = {
  focusMs: 25 * 60_000,
  restMs: 5 * 60_000,
};

export type FocusPhase = "off" | "focusing" | "resting";

export interface FocusSnapshot {
  phase: FocusPhase;
  /** Epoch milliseconds the current phase ends at; null when off. */
  endsAt: number | null;
}

/** What `advance` just finished. "focus_interrupted": the computer slept through the round, which does not count. */
export type FocusTransition = "focus_finished" | "focus_interrupted" | "rest_finished";

/** Ticks come about once a second; a much longer gap means the computer slept. */
const MAX_TICK_GAP_MS = 60_000;

const OFF: FocusSnapshot = { phase: "off", endsAt: null };
const PHASE_LABELS: Record<Exclude<FocusPhase, "off">, string> = { focusing: "专注", resting: "休息" };

/** A running round or rest saved earlier, if it has not ended by `now`. */
export function restoreFocus(saved: FocusSnapshot | null, now: number): FocusSnapshot {
  return saved && saved.phase !== "off" && saved.endsAt !== null && saved.endsAt > now ? saved : OFF;
}

/**
 * A focus round followed by a short rest. Time is passed in, so it can be
 * tested; `onChange` lets the caller save it, so a restart keeps the round.
 */
export class FocusTimer {
  private snapshot: FocusSnapshot;
  private readonly listeners = new Set<() => void>();
  private lastAdvanceAt: number | null = null;

  constructor(initial: FocusSnapshot = OFF, private readonly onChange?: (snapshot: FocusSnapshot) => void) {
    this.snapshot = initial;
  }

  get = (): FocusSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  startFocus(now: number): void {
    this.set({ phase: "focusing", endsAt: now + FOCUS_CONFIG.focusMs });
  }

  stop(): void {
    this.set(OFF);
  }

  /** Moves to the next phase once the current one is over. Call it about once a second. */
  advance(now: number): FocusTransition | null {
    const gap = this.lastAdvanceAt === null ? 0 : now - this.lastAdvanceAt;
    this.lastAdvanceAt = now;
    const { phase, endsAt } = this.snapshot;
    if (phase === "focusing" && gap > MAX_TICK_GAP_MS) {
      this.set(OFF);
      return "focus_interrupted";
    }
    if (endsAt === null || now < endsAt) return null;
    if (phase === "focusing") {
      this.set({ phase: "resting", endsAt: now + FOCUS_CONFIG.restMs });
      return "focus_finished";
    }
    this.set(OFF);
    return "rest_finished";
  }

  private set(next: FocusSnapshot): void {
    if (next.phase === this.snapshot.phase && next.endsAt === this.snapshot.endsAt) return;
    this.snapshot = next;
    this.onChange?.(next);
    for (const listener of [...this.listeners]) listener();
  }
}

/** Badge text such as "专注 24:59", or null when no round is running. */
export function focusBadge(snapshot: FocusSnapshot, now: number): string | null {
  if (snapshot.phase === "off" || snapshot.endsAt === null) return null;
  const seconds = Math.max(0, Math.ceil((snapshot.endsAt - now) / 1000));
  const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
  return `${PHASE_LABELS[snapshot.phase]} ${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
