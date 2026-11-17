import type { PetActivity, PetEmotion, PetSnapshot, PetStats } from "../types";

export const STAT_MIN = 0;
export const STAT_MAX = 100;

const MINUTE_MS = 60_000;
/** Stats only advance in whole steps of this size, which also bounds how often they are saved. */
export const ADVANCE_STEP_MS = MINUTE_MS;
/** Time away from the app counts as rest, but only up to this long. */
export const MAX_OFFLINE_MS = 8 * 60 * MINUTE_MS;

export const DEFAULT_STATS: PetStats = {
  satiety: 70,
  energy: 80,
  mood: 60,
  affinity: 0,
};

/** Stat change per minute for each activity. */
const RATES_PER_MINUTE: Record<PetActivity, Partial<PetStats>> = {
  awake: { satiety: -1 / 3, energy: -1 / 4, mood: -1 / 6 },
  sleeping: { satiety: -1 / 6, energy: 2 },
};

const EMOTION_THRESHOLDS = {
  hungryBelow: 25,
  sleepyBelow: 25,
  happyFrom: 70,
  sadBelow: 30,
};

export function clampStat(value: number): number {
  return Math.min(STAT_MAX, Math.max(STAT_MIN, value));
}

export function applyStatDelta(stats: PetStats, delta: Partial<PetStats>): PetStats {
  return {
    satiety: clampStat(stats.satiety + (delta.satiety ?? 0)),
    energy: clampStat(stats.energy + (delta.energy ?? 0)),
    mood: clampStat(stats.mood + (delta.mood ?? 0)),
    affinity: clampStat(stats.affinity + (delta.affinity ?? 0)),
  };
}

/** Returns the stats after `elapsedMs` spent in the given activity. */
export function applyElapsed(stats: PetStats, elapsedMs: number, activity: PetActivity): PetStats {
  const minutes = Math.max(0, elapsedMs) / MINUTE_MS;
  const rates = RATES_PER_MINUTE[activity];
  return applyStatDelta(stats, {
    satiety: (rates.satiety ?? 0) * minutes,
    energy: (rates.energy ?? 0) * minutes,
    mood: (rates.mood ?? 0) * minutes,
    affinity: (rates.affinity ?? 0) * minutes,
  });
}

/** The emotion is derived from the stats rather than stored. */
export function deriveEmotion(snapshot: PetSnapshot): PetEmotion {
  const { stats, activity } = snapshot;
  if (activity === "sleeping") return "sleepy";
  if (stats.satiety < EMOTION_THRESHOLDS.hungryBelow) return "hungry";
  if (stats.energy < EMOTION_THRESHOLDS.sleepyBelow) return "sleepy";
  if (stats.mood >= EMOTION_THRESHOLDS.happyFrom) return "happy";
  if (stats.mood < EMOTION_THRESHOLDS.sadBelow) return "sad";
  return "calm";
}

/** Builds the starting snapshot, crediting time spent away as rest. */
export function createSnapshot(now: number, saved?: { stats: PetStats; savedAt: number }): PetSnapshot {
  const stats = saved
    ? applyElapsed(saved.stats, Math.min(now - saved.savedAt, MAX_OFFLINE_MS), "sleeping")
    : DEFAULT_STATS;
  return { stats, activity: "awake", lastInteractionAt: now, updatedAt: now };
}

type StateListener = (snapshot: PetSnapshot) => void;

/** Holds the pet's current snapshot. Knows nothing about animation. */
export class PetState {
  private snapshot: PetSnapshot;
  private readonly listeners = new Set<StateListener>();

  constructor(initial: PetSnapshot) {
    this.snapshot = initial;
  }

  get = (): PetSnapshot => this.snapshot;

  subscribe = (listener: StateListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  update(updater: (current: PetSnapshot) => PetSnapshot): void {
    const next = updater(this.snapshot);
    if (next === this.snapshot) return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  changeStats(delta: Partial<PetStats>): void {
    this.update((current) => ({ ...current, stats: applyStatDelta(current.stats, delta) }));
  }

  setActivity(activity: PetActivity): void {
    this.update((current) => (current.activity === activity ? current : { ...current, activity }));
  }

  markInteraction(now: number): void {
    this.update((current) => ({ ...current, lastInteractionAt: now }));
  }

  /**
   * Applies time-based stat changes once at least one full step has passed.
   * A long gap (the computer slept) counts no more than time away from the app.
   */
  advance(now: number): void {
    this.update((current) => {
      const elapsed = now - current.updatedAt;
      if (elapsed < ADVANCE_STEP_MS) return current;
      return {
        ...current,
        stats: applyElapsed(current.stats, Math.min(elapsed, MAX_OFFLINE_MS), current.activity),
        updatedAt: now,
      };
    });
  }
}
