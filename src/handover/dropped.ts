import { HANDOVER_LIMITS } from "./Handover";

/** What the user hands over: the files, and the plain text a drag offers. */
export interface DropContent {
  files: readonly File[];
  text: string;
}

/** What was dragged onto the pet, sorted by local rules: no model call to decide. */
export type Dropped =
  | { kind: "text"; text: string; label: string }
  /** A picture the chat window can look at. */
  | { kind: "image"; file: File }
  /** Something the pet cannot take, with what to tell the user. */
  | { kind: "unreadable"; reason: string };

/** Pictures the chat window takes; it turns them into PNG or JPEG before sending. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const TEXT_EXTENSIONS = new Set([
  "txt", "text", "md", "markdown", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "ini", "conf", "xml", "html", "htm", "css",
  "js", "jsx", "mjs", "ts", "tsx", "py", "rs", "go", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs", "rb", "php", "sh", "zsh", "sql",
]);
const TEXT_TYPES = new Set(["application/json", "application/xml", "application/x-yaml", "application/x-sh"]);
/**
 * Bytes read from the start of a file: enough for more than `HANDOVER_LIMITS.chars` characters
 * however they are encoded, so a longer file always shows as cut.
 */
const READ_BYTES = HANDOVER_LIMITS.chars * 4 + 4;
/** Characters of a file name kept in the label. */
const NAME_CHARS = 40;

const CANNOT_READ = "这个我还看不懂，只认得文字、文本文件和图片。";
const ONE_AT_A_TIME = "一次递一个文件给我就好。";
const EMPTY = "这个文件是空的。";

/** What the chat window's file picker offers: the pictures and text files `readDropped` takes. */
export const ATTACH_ACCEPT = [...IMAGE_TYPES, "text/*", ...TEXT_TYPES, ...[...TEXT_EXTENSIONS].map((extension) => `.${extension}`)].join(",");

/** One entry of a drag, as seen while it is still moving: no file names or contents yet. */
export interface DragItem {
  kind: string;
  type: string;
}

/** Types that say nothing about a file: Finder gives these for .md, .log or .ts files, among others. */
const UNKNOWN_TYPES = new Set(["", "application/octet-stream"]);

/**
 * Whether a drag still moving can be dropped, so the cursor can say no at once. Only what it knows it
 * cannot read is refused: several files, or a file of a type it cannot read. Anything it cannot tell
 * yet (no items shown, a file without a telling type) is left to the drop, which says so in words.
 */
export function mayTake(items: readonly DragItem[]): boolean {
  const files = items.filter((item) => item.kind === "file");
  if (files.length > 1) return false;
  if (files.length === 0) return true;
  const { type } = files[0];
  return UNKNOWN_TYPES.has(type) || IMAGE_TYPES.has(type) || type.startsWith("text/") || TEXT_TYPES.has(type);
}

const extensionOf = (name: string) => /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
const isText = (file: File) => file.type.startsWith("text/") || TEXT_TYPES.has(file.type) || TEXT_EXTENSIONS.has(extensionOf(file.name));

/** How the content reached the pet, as the labels say it: "拖进来" onto the pet, "添加" in the chat window. */
export type HandedHow = "拖进来" | "添加";

/** The file name on one line, without the brackets that mark the data block. */
function nameLabel(name: string, how: HandedHow): string {
  const plain = name.replace(/[【】\s]+/g, " ").trim();
  const chars = [...plain];
  return `${how}的文件：${chars.length > NAME_CHARS ? `${chars.slice(0, NAME_CHARS).join("")}…` : plain}`;
}

async function readTextFile(file: File, how: HandedHow): Promise<Dropped> {
  try {
    const text = await file.slice(0, READ_BYTES).text();
    // A NUL byte: a binary file with a text-like name.
    if (text.includes("\u0000")) return { kind: "unreadable", reason: CANNOT_READ };
    return text.trim() ? { kind: "text", text, label: nameLabel(file.name, how) } : { kind: "unreadable", reason: EMPTY };
  } catch (error) {
    // A folder, or a file that went away.
    console.warn("Could not read the dropped file", error);
    return { kind: "unreadable", reason: CANNOT_READ };
  }
}

/** Works out what the user handed over. A file wins over the text a file drag also carries (its path). */
export async function readDropped(drop: DropContent, how: HandedHow = "拖进来"): Promise<Dropped> {
  if (drop.files.length > 1) return { kind: "unreadable", reason: ONE_AT_A_TIME };
  const [file] = drop.files;
  if (file) {
    if (IMAGE_TYPES.has(file.type)) return { kind: "image", file };
    return isText(file) ? readTextFile(file, how) : { kind: "unreadable", reason: CANNOT_READ };
  }
  const text = drop.text.trim();
  return text ? { kind: "text", text, label: `${how}的文字` } : { kind: "unreadable", reason: CANNOT_READ };
}
