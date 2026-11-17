export const SPEECH_CONFIG = {
  /** Longer lines are cut; the bubble is for short remarks, not paragraphs. */
  maxChars: 60,
  /** Lines waiting behind the one on show. The oldest waiting line is dropped first. */
  maxWaiting: 3,
  /** How long a line stays up: a base plus time per character, within these bounds. */
  baseMs: 1_500,
  perCharMs: 120,
  minMs: 2_500,
  maxMs: 8_000,
  /** Pause between two lines, so a new one reads as new. */
  gapMs: 250,
};

const ELLIPSIS = "…";

export function fitSpeech(text: string): string {
  const chars = [...text.trim()];
  return chars.length <= SPEECH_CONFIG.maxChars ? chars.join("") : `${chars.slice(0, SPEECH_CONFIG.maxChars - 1).join("")}${ELLIPSIS}`;
}

export function speechDuration(text: string): number {
  const { baseMs, perCharMs, minMs, maxMs } = SPEECH_CONFIG;
  return Math.min(maxMs, Math.max(minMs, baseMs + [...text].length * perCharMs));
}

/** Shows one line at a time, each for a time that suits its length. */
export class SpeechQueue {
  private showing: string | null = null;
  private waiting: string[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onChange: (line: string | null) => void) {}

  push(text: string): void {
    const line = fitSpeech(text);
    if (!line) return;
    if (this.showing === null && this.timer === null) {
      this.show(line);
      return;
    }
    this.waiting = [...this.waiting, line].slice(-SPEECH_CONFIG.maxWaiting);
  }

  /** Hides the current line and forgets the waiting ones. */
  clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.waiting = [];
    if (this.showing !== null) {
      this.showing = null;
      this.onChange(null);
    }
  }

  private show(line: string): void {
    this.showing = line;
    this.onChange(line);
    this.timer = setTimeout(() => this.hide(), speechDuration(line));
  }

  private hide(): void {
    this.showing = null;
    this.onChange(null);
    this.timer = setTimeout(() => this.next(), SPEECH_CONFIG.gapMs);
  }

  private next(): void {
    this.timer = null;
    const [line, ...rest] = this.waiting;
    this.waiting = rest;
    if (line !== undefined) this.show(line);
  }
}
