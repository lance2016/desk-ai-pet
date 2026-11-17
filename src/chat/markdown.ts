/**
 * The small part of Markdown that chat replies use: paragraphs, headings, lists,
 * code blocks, bold, italic, inline code and links. Tables, quotes and rules
 * are turned into clean plain text. Anything else stays as plain text.
 * The result is data, rendered as React elements, so no HTML from the model is ever injected.
 */
export type Inline = { kind: "text" | "strong" | "em" | "code"; text: string } | { kind: "link"; text: string; url: string };
export type Block =
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "heading"; inline: Inline[] }
  | { kind: "list"; ordered: boolean; start: number; items: Inline[][] }
  | { kind: "code"; text: string };

const INLINE = /`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()（）]*[^\s<>()（）.,;:!?。，；：！？、"'”’])|\*\*([^*\n]+?)\*\*|\*([^*\s](?:[^*\n]*[^*\s])?)\*/g;
const FENCE = /^\s*```/;
const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,3})(?:[.)]\s+|、\s*)(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_ROW = /^\s*\|(.*)\|\s*$/;
const TABLE_DIVIDER = /^\s*\|?(\s*:?-{2,}:?\s*\|)+\s*(:?-{2,}:?\s*)?\|?\s*$/;

/** A line without the Markdown that the chat does not draw: quote marks, table bars. Null for a line to drop. */
function plainLine(line: string): string | null {
  if (RULE.test(line) || TABLE_DIVIDER.test(line)) return null;
  const row = TABLE_ROW.exec(line);
  if (row) return row[1].split("|").map((cell) => cell.trim()).filter(Boolean).join("　");
  const quote = QUOTE.exec(line);
  return quote ? quote[1] : line;
}

export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: "text", text: text.slice(last, index) });
    const [, code, label, target, bare, strong, em] = match;
    if (code !== undefined) parts.push({ kind: "code", text: code });
    else if (label !== undefined) parts.push({ kind: "link", text: label, url: target });
    else if (bare !== undefined) parts.push({ kind: "link", text: bare, url: bare });
    else if (strong !== undefined) parts.push({ kind: "strong", text: strong });
    else parts.push({ kind: "em", text: em });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    const raw = lines[index];
    if (FENCE.test(raw)) {
      const end = lines.findIndex((next, at) => at > index && FENCE.test(next));
      const stop = end === -1 ? lines.length : end;
      blocks.push({ kind: "code", text: lines.slice(index + 1, stop).join("\n") });
      index = stop + 1;
      continue;
    }
    index += 1;
    const plain = plainLine(raw);
    if (plain === null || !plain.trim()) continue;
    const line = plain;
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    const previous = blocks[blocks.length - 1];
    // A table divider joins the rows around it; a rule splits what is above from below.
    const before = index >= 2 ? lines[index - 2] : "";
    const follows = before.trim() !== "" && !RULE.test(before);
    if (heading) blocks.push({ kind: "heading", inline: parseInline(heading[1]) });
    else if (bullet || numbered) {
      const ordered = numbered !== null && bullet === null;
      const item = parseInline((ordered ? numbered?.[2] : bullet?.[1]) ?? "");
      if (previous?.kind === "list" && previous.ordered === ordered && follows) previous.items.push(item);
      else blocks.push({ kind: "list", ordered, start: ordered ? Number(numbered?.[1]) : 1, items: [item] });
    } else if (previous?.kind === "paragraph" && follows) previous.lines.push(parseInline(line));
    else blocks.push({ kind: "paragraph", lines: [parseInline(line)] });
  }
  return blocks;
}

const inlinePlain = (parts: Inline[]) => parts.map((part) => (part.kind === "link" && part.url !== part.text ? `${part.text}（${part.url}）` : part.text)).join("");

/** A Markdown reply as plain text that keeps its line breaks, e.g. for a note. */
export function markdownToPlain(source: string): string {
  return parseMarkdown(source)
    .map((block) => {
      if (block.kind === "paragraph") return block.lines.map(inlinePlain).join("\n");
      if (block.kind === "heading") return inlinePlain(block.inline);
      if (block.kind === "list") return block.items.map((item, at) => `${block.ordered ? `${block.start + at}.` : "·"} ${inlinePlain(item)}`).join("\n");
      return block.text;
    })
    .join("\n")
    .trim();
}
