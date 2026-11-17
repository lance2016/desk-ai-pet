import { minutesOf } from "../preferences/QuietPreferences";
import type { CompanionPreferences } from "../preferences/CompanionPreferences";

const ACTIVE_SECONDS = 60;
const BREAK_SECONDS = 5 * 60;
const AWAY_SECONDS = 30 * 60;
const MAX_SAMPLE_GAP_MS = 2 * 60_000;
const NIGHT_ACTIVE_MS = 15 * 60_000;
const RETURN_GAP_MS = 2 * 60 * 60_000;
const NIGHT_END_MINUTES = 4 * 60;
const NIGHT_RECORD = "ai-pet:companion-night:v1";

/** Uses only elapsed idle time. A missed poll resets the session instead of guessing. */
export class Companion {
  private lastSample: number | null = null;
  private activeSince: number | null = null;
  private away = false;
  private lastReturn: number | null = null;

  constructor(private readonly storage: Storage, private readonly greet: (text: string, allowQuiet?: boolean) => boolean) {}

  check(now: number, idleSeconds: number, settings: CompanionPreferences, busy: boolean): void {
    if (!Number.isFinite(idleSeconds) || idleSeconds < 0) return;
    if (this.lastSample !== null && (now < this.lastSample || now - this.lastSample > MAX_SAMPLE_GAP_MS)) {
      this.activeSince = null;
      this.away = false;
    }
    this.lastSample = now;
    if (idleSeconds >= BREAK_SECONDS) this.activeSince = null;
    if (idleSeconds >= AWAY_SECONDS) this.away = true;
    if (idleSeconds > ACTIVE_SECONDS) return;
    this.activeSince ??= now;
    if (busy) { this.away = false; return; }
    if (this.away) {
      this.away = false;
      if (settings.welcomeBack && (this.lastReturn === null || now - this.lastReturn >= RETURN_GAP_MS) && this.greet("回来啦，欢迎回来～")) this.lastReturn = now;
      return;
    }
    const date = new Date(now);
    const minute = date.getHours() * 60 + date.getMinutes();
    const start = minutesOf(settings.nightTime);
    const inNight = start >= NIGHT_END_MINUTES ? minute >= start || minute < NIGHT_END_MINUTES : minute >= start && minute < NIGHT_END_MINUTES;
    const nightDate = new Date(now);
    if (start >= NIGHT_END_MINUTES && minute < NIGHT_END_MINUTES) nightDate.setDate(nightDate.getDate() - 1);
    const nightKey = `${nightDate.getFullYear()}-${nightDate.getMonth() + 1}-${nightDate.getDate()}`;
    if (settings.night && inNight && now - this.activeSince >= NIGHT_ACTIVE_MS && this.storage.getItem(NIGHT_RECORD) !== nightKey) {
      if (this.greet("已经很晚啦，忙完这一点就休息吧。", settings.nightDuringQuiet)) this.storage.setItem(NIGHT_RECORD, nightKey);
      return;
    }
    if (settings.rest && now - this.activeSince >= settings.restMinutes * 60_000 && this.greet("我想伸个懒腰，你也休息一下吧。")) this.activeSince = now;
  }
}
