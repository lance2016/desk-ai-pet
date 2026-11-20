const ACTIVE_SECONDS = 60;
const BREAK_SECONDS = 5 * 60;
const AWAY_SECONDS = 30 * 60;
const MAX_SAMPLE_GAP_MS = 2 * 60_000;

export interface PresenceSample {
  /** How long the user has been active without a real break; null while they are not at the computer right now. */
  activeMs: number | null;
  /** True on the one sample that finds the user back after a long time away. */
  returned: boolean;
}

const NOT_HERE: PresenceSample = { activeMs: null, returned: false };

/** Follows whether the user is at the computer. Uses only elapsed idle time; a missed poll resets the session instead of guessing. */
export class Presence {
  private lastSample: number | null = null;
  private activeSince: number | null = null;
  private away = false;

  /** `idleSeconds`: how long the keyboard and mouse have been still, null when not known. */
  sample(now: number, idleSeconds: number | null): PresenceSample {
    if (idleSeconds === null || !Number.isFinite(idleSeconds) || idleSeconds < 0) return NOT_HERE;
    if (this.lastSample !== null && (now < this.lastSample || now - this.lastSample > MAX_SAMPLE_GAP_MS)) {
      this.activeSince = null;
      this.away = false;
    }
    this.lastSample = now;
    if (idleSeconds >= BREAK_SECONDS) this.activeSince = null;
    if (idleSeconds >= AWAY_SECONDS) this.away = true;
    if (idleSeconds > ACTIVE_SECONDS) return NOT_HERE;
    this.activeSince ??= now;
    const returned = this.away;
    this.away = false;
    return { activeMs: now - this.activeSince, returned };
  }
}
