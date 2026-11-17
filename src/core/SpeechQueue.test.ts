import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fitSpeech, SPEECH_CONFIG, SpeechQueue, speechDuration } from "./SpeechQueue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function track() {
  const shown: Array<string | null> = [];
  return { shown, queue: new SpeechQueue((line) => shown.push(line)) };
}

describe("SpeechQueue", () => {
  it("shows a line, hides it after its duration, then shows the next", () => {
    const { shown, queue } = track();
    queue.push("早上好");
    queue.push("今天先做哪件事？");
    expect(shown).toEqual(["早上好"]);
    vi.advanceTimersByTime(speechDuration("早上好"));
    expect(shown).toEqual(["早上好", null]);
    vi.advanceTimersByTime(SPEECH_CONFIG.gapMs);
    expect(shown).toEqual(["早上好", null, "今天先做哪件事？"]);
  });

  it("keeps only the newest waiting lines", () => {
    const { shown, queue } = track();
    ["a", "b", "c", "d", "e"].forEach((line) => queue.push(line));
    for (let step = 0; step < 4; step += 1) vi.advanceTimersByTime(SPEECH_CONFIG.maxMs + SPEECH_CONFIG.gapMs);
    expect(shown.filter((line) => line !== null)).toEqual(["a", "c", "d", "e"]);
  });

  it("ignores blank lines and clears everything on request", () => {
    const { shown, queue } = track();
    queue.push("   ");
    expect(shown).toEqual([]);
    queue.push("hi");
    queue.push("again");
    queue.clear();
    vi.advanceTimersByTime(SPEECH_CONFIG.maxMs * 2);
    expect(shown).toEqual(["hi", null]);
  });

  it("cuts long lines and bounds how long they stay", () => {
    const long = "字".repeat(100);
    expect([...fitSpeech(long)]).toHaveLength(SPEECH_CONFIG.maxChars);
    expect(fitSpeech(long).endsWith("…")).toBe(true);
    expect(speechDuration("嗨")).toBe(SPEECH_CONFIG.minMs);
    expect(speechDuration(long)).toBe(SPEECH_CONFIG.maxMs);
  });
});
