const ACTIVE_SECONDS = 60;
const BREAK_SECONDS = 5 * 60;
const AWAY_SECONDS = 30 * 60;
const MAX_SAMPLE_GAP_MS = 2 * 60_000;

export interface PresenceSample {
  /** How long the user has been active without a real break; null while they are not at the computer right now. */
  activeMs: number | null;
  /** True on the one sample that finds the user back after a long time away. */
  returned: boolean;
  /**
   * When the user was last at the computer before a long time away, on the one sample that finds them back.
   * Also known when the computer slept through that time, which `returned` does not count. Null otherwise.
   */
  leftAt: number | null;
}

const NOT_HERE: PresenceSample = { activeMs: null, returned: false, leftAt: null };

/** Follows whether the user is at the computer. Uses only elapsed idle time; a missed poll resets the session instead of guessing. */
export class Presence {
  private lastSample: number | null = null;
  private activeSince: number | null = null;
  private away = false;
  /** The last moment the keyboard or mouse was used. */
  private lastSeen: number | null = null;
  private leftAt: number | null = null;

  /** `idleSeconds`: how long the keyboard and mouse have been still, null when not known. */
  sample(now: number, idleSeconds: number | null): PresenceSample {
    if (idleSeconds === null || !Number.isFinite(idleSeconds) || idleSeconds < 0) return NOT_HERE;
    const seen = now - idleSeconds * 1000;
    if (this.lastSample !== null && (now < this.lastSample || now - this.lastSample > MAX_SAMPLE_GAP_MS)) {
      this.activeSince = null;
      this.away = false;
      // Nothing is known about the gap itself, but a long one still means the user was not here.
      this.leftAt = this.lastSeen !== null && now - this.lastSeen >= AWAY_SECONDS * 1000 ? this.lastSeen : null;
    }
    this.lastSample = now;
    if (idleSeconds >= BREAK_SECONDS) this.activeSince = null;
    if (idleSeconds >= AWAY_SECONDS) {
      this.away = true;
      this.leftAt ??= seen;
    }
    if (idleSeconds > ACTIVE_SECONDS) return NOT_HERE;
    this.lastSeen = seen;
    this.activeSince ??= now;
    const sample = { activeMs: now - this.activeSince, returned: this.away, leftAt: this.leftAt };
    this.away = false;
    this.leftAt = null;
    return sample;
  }
}
