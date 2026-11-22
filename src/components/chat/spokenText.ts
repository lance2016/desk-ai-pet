/** The most MiMo reads in one request, in characters. Must match the limit in `mimo_synthesize` (`src-tauri/src/mimo.rs`). */
export const MAX_SPOKEN_CHARS = 3_000;
const SENTENCE_END = /[。！？!?…\n]/u;

/** What is read aloud of a reply: all of it when it fits, else up to the last sentence end that fits. */
export function spokenText(plain: string): string {
  const characters = [...plain.trim()];
  if (characters.length <= MAX_SPOKEN_CHARS) return characters.join("");
  const head = characters.slice(0, MAX_SPOKEN_CHARS);
  for (let index = head.length - 1; index > 0; index--) {
    if (SENTENCE_END.test(head[index])) return head.slice(0, index + 1).join("").trim();
  }
  return head.join("");
}
