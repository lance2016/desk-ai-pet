/** The most a script may hold, in characters: about 1.6 yuan of synthesis at 0.8 yuan per 10,000. */
export const MAX_SCRIPT_CHARS = 20_000;
/** The longest piece synthesized at once; also a comfortable subtitle line. Well under `mimo_synthesize`'s 3,000. */
export const MAX_SEGMENT_CHARS = 200;

const ENDS = new Set([..."。！？!?；;…"]);
const CLOSERS = new Set([..."\"'”’」』）)】》"]);
const SOFT_BREAKS = new Set([..."，,、：:— "]);
const SPEAKABLE = /[\p{L}\p{N}]/u;

/** Cuts a piece longer than `MAX_SEGMENT_CHARS`, preferring the last comma or space in its second half. */
function limitLength(piece: string): string[] {
  const chars = [...piece];
  if (chars.length <= MAX_SEGMENT_CHARS) return [piece];
  let cut = MAX_SEGMENT_CHARS;
  for (let index = MAX_SEGMENT_CHARS - 1; index >= MAX_SEGMENT_CHARS / 2; index--) {
    if (SOFT_BREAKS.has(chars[index])) { cut = index + 1; break; }
  }
  return [chars.slice(0, cut).join("").trim(), ...limitLength(chars.slice(cut).join("").trim())].filter(Boolean);
}

/**
 * The script as the pieces it is read in: one per sentence or line, each short enough to
 * synthesize at once and to show as one subtitle. Punctuation with nothing to say joins the piece before it.
 */
export function splitScript(text: string): string[] {
  const pieces: string[] = [];
  const add = (piece: string) => {
    const trimmed = piece.trim();
    if (!trimmed) return;
    if (SPEAKABLE.test(trimmed)) pieces.push(trimmed);
    else if (pieces.length > 0) pieces[pieces.length - 1] += trimmed;
  };
  const chars = [...text.replace(/\r\n?/g, "\n")];
  let current = "";
  let ended = false;
  chars.forEach((char, index) => {
    if (char === "\n" || (ended && !ENDS.has(char) && !CLOSERS.has(char))) {
      add(current);
      current = "";
      ended = false;
      if (char === "\n") return;
    }
    current += char;
    const next = chars[index + 1];
    ended = ENDS.has(char) || (ended && CLOSERS.has(char)) || (char === "." && (next === undefined || /\s/.test(next)));
  });
  add(current);
  return pieces.flatMap(limitLength);
}
