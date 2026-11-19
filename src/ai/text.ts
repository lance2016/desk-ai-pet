const encoder = new TextEncoder();

/** Length in UTF-8 bytes, as the model service counts a request. */
export const utf8Length = (text: string): number => encoder.encode(text).length;

/** The longest start of `text` that fits in `max` UTF-8 bytes, never splitting a character. */
export function utf8Prefix(text: string, max: number): string {
  let used = 0;
  let end = 0;
  for (const char of text) {
    used += utf8Length(char);
    if (used > max) break;
    end += char.length;
  }
  return text.slice(0, end);
}
