import type { WebMode, WebReply } from "../../chat/ReadLinks";
import { LINK_CONTEXT_BUDGET } from "../../chat/ReadLinks";
import { utf8Length } from "../text";

/** DeepSeek's own tools for reading a page and searching the web; they run on its servers. */
export const READ_TOOL = "deepseek_read_url";
export const SEARCH_TOOL = "deepseek_web_search";
const MAX_SOURCES = 20;
const MAX_URL_BYTES = 2048;
const MAX_TITLE_CHARS = 256;

/** What a webpage or search turn reports while it runs; `WEB_PROGRESS` in the chat window words it. */
export type WebProgress = "reading" | "read" | "failed" | "searching" | "searched" | "search-failed";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const field = (value: unknown, key: string): unknown => (isObject(value) ? value[key] : undefined);

export function webTools(mode: WebMode): object[] | undefined {
  if (mode === "open") return [{ type: READ_TOOL }];
  if (mode === "search") return [{ type: SEARCH_TOOL }];
  return undefined;
}

/** The webpage parts of one streamed packet. Calls and citations come with the last one. */
export interface WebDelta { event?: unknown; calls?: unknown[]; annotations?: unknown[] }

export function webDelta(choice: Json): WebDelta {
  const delta = field(choice, "delta");
  const last = typeof choice.finish_reason === "string";
  const list = (key: string) => {
    const value = field(delta, key);
    return last && Array.isArray(value) ? value : undefined;
  };
  return { event: choice.server_tool_event, calls: list("server_tool_calls"), annotations: list("annotations") };
}

function calls(steps: readonly unknown[]): Json[] {
  return steps.flatMap((step) => {
    const list = field(step, "calls");
    return Array.isArray(list) ? list.filter(isObject) : [];
  });
}

const successfulRead = (call: Json) => call.type === READ_TOOL && call.status === "completed";

function hasSnapshot(steps: readonly unknown[]): boolean {
  return calls(steps).some((call) => successfulRead(call) && typeof call.signature === "string" && call.signature !== "");
}

/** The provider's opaque page state saved with a reply, put back as it was so a follow-up can use it. */
export function restoreCalls(web: WebReply | undefined): unknown[] | null {
  if (!web?.calls || utf8Length(web.calls) > LINK_CONTEXT_BUDGET) return null;
  try {
    const value: unknown = JSON.parse(web.calls);
    return Array.isArray(value) && hasSnapshot(value) ? value : null;
  } catch {
    return null;
  }
}

/** What a webpage or search reply found, gathered over its packets. */
export class WebResult {
  private calls?: unknown[];
  private annotations?: unknown[];

  /** Takes in a packet; returns the progress to show, if it changed. */
  update(delta: WebDelta): WebProgress | null {
    if (delta.calls) this.calls = delta.calls;
    if (delta.annotations) this.annotations = delta.annotations;
    const type = field(delta.event, "type");
    const call = field(delta.event, "call");
    if (typeof type !== "string" || !isObject(call)) return null;
    if (call.type === SEARCH_TOOL) {
      if (type === "call_started") return "searching";
      if (type === "call_completed") return call.status === "completed" ? "searched" : "search-failed";
      return null;
    }
    if (call.type !== READ_TOOL) return null;
    if (type === "call_started") return "reading";
    if (type === "call_completed") return successfulRead(call) ? "read" : "failed";
    return null;
  }

  readPage(): boolean {
    return calls(this.calls ?? []).some(successfulRead);
  }

  foundSources(): boolean {
    return calls(this.calls ?? []).some((call) => call.type === SEARCH_TOOL && call.status === "completed"
      && Array.isArray(call.sources) && call.sources.some((source) => typeof field(source, "url") === "string"));
  }

  /** The sources to show under the reply, and the page state to save for follow-ups. */
  payload(truncated: boolean): WebReply {
    const sources: WebReply["sources"] = [];
    const addSource = (entry: unknown) => {
      const url = field(entry, "url");
      if (typeof url !== "string" || utf8Length(url) > MAX_URL_BYTES || !/^https?:\/\//.test(url) || /[\s\p{Cc}]/u.test(url)
        || sources.length >= MAX_SOURCES || sources.some((source) => source.url === url)) return;
      const title = field(entry, "title");
      sources.push({ url, title: Array.from(typeof title === "string" ? title.trim() : "").slice(0, MAX_TITLE_CHARS).join("") });
    };
    for (const citation of this.annotations ?? []) {
      if (field(citation, "type") === "url_citation") addSource(field(citation, "url_citation"));
    }
    let incomplete = false;
    let snapshot: string | undefined;
    if (this.calls) {
      for (const call of calls(this.calls)) {
        if (successfulRead(call)) addSource(call.page);
        else if (call.type === SEARCH_TOOL && call.status === "completed") {
          for (const source of Array.isArray(call.sources) ? call.sources : []) if (field(source, "type") === "url") addSource(source);
        } else if (call.type === READ_TOOL || call.type === SEARCH_TOOL) incomplete = true;
      }
      if (hasSnapshot(this.calls)) {
        const serialized = JSON.stringify(this.calls);
        if (utf8Length(serialized) <= LINK_CONTEXT_BUDGET) snapshot = serialized;
      }
    }
    return { sources, incomplete, truncated, ...(snapshot ? { calls: snapshot } : {}) };
  }
}
