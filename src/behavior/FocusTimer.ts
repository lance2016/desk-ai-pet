/**
 * How long a round runs, by its minutes, and the rest after it: the usual 25, or 50 for deep work with a longer rest.
 * A new length goes into the schemas in FocusStorage.ts and FocusPreferences.ts too.
 */
export const FOCUS_PLANS = {
  25: { focusMs: 25 * 60_000, restMs: 5 * 60_000 },
  50: { focusMs: 50 * 60_000, restMs: 10 * 60_000 },
} as const;
export type FocusMinutes = keyof typeof FOCUS_PLANS;
export const FOCUS_MINUTES: readonly FocusMinutes[] = [25, 50];
export const DEFAULT_FOCUS_MINUTES: FocusMinutes = 25;

export type FocusPhase = "off" | "focusing" | "resting";

export interface FocusSnapshot {
  phase: FocusPhase;
  /** Epoch milliseconds the current phase ends at; null when off. */
  endsAt: number | null;
  /** How long this round runs, and so its rest. Left out by rounds saved before it could be chosen: 25. */
  minutes?: FocusMinutes;
}

/** The lengths of a round and of its rest. */
export const focusPlan = (snapshot: FocusSnapshot) => FOCUS_PLANS[snapshot.minutes ?? DEFAULT_FOCUS_MINUTES];

/** What `advance` just finished. "focus_interrupted": the computer slept through the end of the round, which does not count. */
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

  startFocus(now: number, minutes: FocusMinutes = DEFAULT_FOCUS_MINUTES): void {
    this.set({ phase: "focusing", endsAt: now + FOCUS_PLANS[minutes].focusMs, minutes });
  }

  stop(): void {
    this.set(OFF);
  }

  /** Moves to the next phase once the current one is over. Call it about once a second. */
  advance(now: number): FocusTransition | null {
    const gap = this.lastAdvanceAt === null ? 0 : now - this.lastAdvanceAt;
    this.lastAdvanceAt = now;
    const { phase, endsAt, minutes } = this.snapshot;
    if (endsAt === null || now < endsAt) return null;
    // Woken before the end, the round simply goes on; one that ended while the computer slept was not sat through.
    if (phase === "focusing" && gap > MAX_TICK_GAP_MS) {
      this.set(OFF);
      return "focus_interrupted";
    }
    if (phase === "focusing") {
      this.set({ phase: "resting", endsAt: now + focusPlan(this.snapshot).restMs, minutes });
      return "focus_finished";
    }
    this.set(OFF);
    return "rest_finished";
  }

  private set(next: FocusSnapshot): void {
    if (next.phase === this.snapshot.phase && next.endsAt === this.snapshot.endsAt && next.minutes === this.snapshot.minutes) return;
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

/** How much of the running round or rest has passed, from 0 to 1, or null when off. */
export function focusProgress(snapshot: FocusSnapshot, now: number): number | null {
  if (snapshot.phase === "off" || snapshot.endsAt === null) return null;
  const plan = focusPlan(snapshot);
  const length = snapshot.phase === "focusing" ? plan.focusMs : plan.restMs;
  return Math.min(1, Math.max(0, 1 - (snapshot.endsAt - now) / length));
}
