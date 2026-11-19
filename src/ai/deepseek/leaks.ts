import { ACTION_ID } from "../skill";

/** The tool DeepSeek has been seen writing into the text; the pet action skill offers it. */
const PLAY_ACTION_TOOL = "play_action";

/**
 * DeepSeek sometimes leaks part of its own prompt format into a reply, such as
 * `<budget:token_budget>200000</budget:token_budget>` after a play_action call. It is never for the user.
 */
const LEAKED_OPEN = "<budget:";
const LEAKED_CLOSE = "</budget:";
const SEPARATORS = /^[\s(){}:="'`,]*/;

/** `text` without complete leaked tags; an unfinished one at the end stays. */
export function stripLeaked(text: string): string {
  let clean = "";
  let rest = text;
  for (let start = rest.indexOf(LEAKED_OPEN); start >= 0; start = rest.indexOf(LEAKED_OPEN)) {
    clean += rest.slice(0, start);
    const tag = rest.slice(start);
    const close = tag.indexOf(LEAKED_CLOSE);
    const end = close < 0 ? -1 : tag.indexOf(">", close);
    if (end < 0) { rest = tag; break; }
    rest = tag.slice(end + 1);
  }
  return clean + rest;
}

/**
 * The action id in what follows a leaked tool name, such as `\naction=dance` or `({"action": "wave"})`,
 * and how much of `text` the call takes up.
 */
function leakedArgument(text: string): { id: string; used: number } | null {
  const head = text.replace(SEPARATORS, "");
  if (!head.startsWith("action")) return null;
  const value = head.slice("action".length).replace(SEPARATORS, "");
  const id = /^[a-z0-9_]*/.exec(value)?.[0] ?? "";
  if (!ACTION_ID.test(id)) return null;
  const after = value.slice(id.length).replace(/^["'`)}]*/, "");
  return { id, used: text.length - after.length };
}

/**
 * DeepSeek sometimes writes a pet action into the reply instead of calling the tool, as in
 * "我这就跳舞！ play_action\naction=dance". Strips the leaked syntax from the text.
 * Only the spelled-out form with an `action` key counts, so a reply that merely names the tool is left alone.
 */
export function takeLeakedActions(text: string): { text: string; actions: string[] } {
  let clean = "";
  const actions: string[] = [];
  let rest = text;
  for (let start = rest.indexOf(PLAY_ACTION_TOOL); start >= 0; start = rest.indexOf(PLAY_ACTION_TOOL)) {
    const after = rest.slice(start + PLAY_ACTION_TOOL.length);
    const found = leakedArgument(after);
    if (found) {
      clean += rest.slice(0, start).replace(/[ \t]+$/, "");
      actions.push(found.id);
      rest = after.slice(found.used);
    } else {
      clean += rest.slice(0, start + PLAY_ACTION_TOOL.length);
      rest = after;
    }
  }
  clean += rest;
  return { text: actions.length > 0 ? clean.trimEnd() : clean, actions };
}

/** Where `marker` starts in `text`, or where an unfinished one may start at its end. */
function markerStart(text: string, marker: string): number | null {
  const at = text.indexOf(marker);
  if (at >= 0) return at;
  // The markers have their first character only once, so the last one is the place to look.
  const start = text.lastIndexOf(marker[0]);
  return start >= 0 && marker.startsWith(text.slice(start)) ? start : null;
}

/**
 * The reply's text on its way to the window, without leaked tags or leaked action calls.
 * Either can arrive split over several chunks, so text that may still turn into one is held
 * back: a tag until it is clear, an action call until the reply ends.
 * Blank lines before the first words are dropped: a reply of only those has said nothing.
 */
export class ReplyText {
  private pending = "";
  private started = false;

  /** Takes the next chunk; returns the text that can be shown now. */
  push(text: string): string {
    this.pending = stripLeaked(this.pending + text);
    if (!this.started) this.pending = this.pending.trimStart();
    const tag = markerStart(this.pending, LEAKED_OPEN);
    const callAt = markerStart(this.pending, PLAY_ACTION_TOOL);
    // The space before a written-out call goes with it.
    const call = callAt === null ? null : this.pending.slice(0, callAt).replace(/[ \t]+$/, "").length;
    const holds = [tag, call].filter((at): at is number => at !== null);
    const hold = holds.length > 0 ? Math.min(...holds) : this.pending.length;
    const ready = this.pending.slice(0, hold);
    this.pending = this.pending.slice(hold);
    this.started ||= ready.length > 0;
    return ready;
  }

  /** The text still held when the reply ends; an unfinished leaked tag is dropped, and written-out calls are removed. */
  finish(): string {
    const rest = this.pending;
    this.pending = "";
    return rest.startsWith(LEAKED_OPEN) ? "" : takeLeakedActions(rest).text;
  }
}
