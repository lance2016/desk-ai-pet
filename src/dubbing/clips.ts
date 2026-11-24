/** One piece of the script with the voice and delivery it is read in. */
export interface Line { key: string; text: string; voice: string; style: string }

/** The audio of one line: being made, made, or failed with the service's message. */
export type Clip = { status: "making" } | { status: "ready"; pcm: Uint8Array } | { status: "failed"; error: string };
export type Clips = ReadonlyMap<string, Clip>;

/** The script's pieces as lines. The key changes with the words, the voice or the delivery, so changing any of them means new audio. */
export function linesOf(texts: readonly string[], voice: string, style: string): Line[] {
  return texts.map((text) => ({ key: JSON.stringify([voice, style, text]), text, voice, style }));
}

/** The lines to start now: in script order, each sentence once, no more than the free slots. */
export function nextLines(lines: readonly Line[], clips: Clips, running: number, limit: number): Line[] {
  const picked = new Map<string, Line>();
  for (const line of lines) {
    if (running + picked.size >= limit) break;
    if (!clips.has(line.key) && !picked.has(line.key)) picked.set(line.key, line);
  }
  return [...picked.values()];
}

/** The clips still in the script; with `failed`, failed ones are dropped too so a new run tries them again. */
export function withoutStale(clips: Clips, lines: readonly Line[], options: { failed?: boolean } = {}): Clips {
  const wanted = new Set(lines.map((line) => line.key));
  return new Map([...clips].filter(([key, clip]) => wanted.has(key) && !(options.failed && clip.status === "failed")));
}

export function progressOf(lines: readonly Line[], clips: Clips) {
  const status = lines.map((line) => clips.get(line.key)?.status);
  const count = (value: Clip["status"]) => status.filter((item) => item === value).length;
  return { total: lines.length, ready: count("ready"), failed: count("failed"), missing: status.filter((item) => item === undefined).length };
}
