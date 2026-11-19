import type { WebMode } from "../chat/ReadLinks";
import { llmPlatform } from "../platform/llm";
import { ReplyText } from "./deepseek/leaks";
import { webDelta, WebResult } from "./deepseek/web";
import { clipLocalLookup, lookupResults } from "./lookup";
import { DEEPSEEK, failureMessage, isSuccess } from "./provider";
import { RequestRecord } from "./requestLog";
import { lookupRequest, type RequestBody } from "./requests";
import { parseStreamData, ToolCallCollector, type ToolCall } from "./stream";
import { LOOKUP_TOOLS, PLAY_ACTION_TOOL } from "./tools";
import type { ChatContext, ChatEvent } from "./types";

type Kind = ChatEvent["kind"];
type Emit = (kind: Kind, text: string) => void;
type Lists = Pick<ChatContext, "reminders" | "notes" | "today">;
interface RoundEnd { status: number | null; ok: boolean; cancelled: boolean }

export const NO_LISTS: Lists = { reminders: [], notes: [], today: [] };
const LOOKUP_UNAVAILABLE = "查到了记录，但暂时没法整理答案。可以在提醒或备忘面板查看。";

/** The streamed requests of this window, by request id, and the windows parts listening to replies. */
const consumers = new Map<string, { data: (data: string) => void; end: (end: RoundEnd) => void }>();
const listeners = new Set<(event: ChatEvent) => void>();
let transport: Promise<unknown> | null = null;

function ensureTransport(): Promise<unknown> {
  transport ??= llmPlatform.subscribe((event) => {
    const consumer = consumers.get(event.id);
    if (!consumer) return;
    if (event.kind === "data") consumer.data(event.data);
    else { consumers.delete(event.id); consumer.end(event); }
  }).catch((error: unknown) => { transport = null; throw error; });
  return transport;
}

/** Starts one streamed request; resolves once it is on its way, with a promise of its end. */
async function startRound(id: string, body: RequestBody, onData: (data: string) => void): Promise<{ ended: Promise<RoundEnd> }> {
  await ensureTransport();
  const ended = new Promise<RoundEnd>((resolve) => consumers.set(id, { data: onData, end: resolve }));
  try { await llmPlatform.stream(DEEPSEEK.id, id, body); }
  catch (error) { consumers.delete(id); throw error; }
  return { ended };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The first action call whose arguments are complete and name an action on offer. */
function readyAction(calls: readonly ToolCall[], allowed: readonly string[]): string | null {
  for (const call of calls) {
    if (call.name !== PLAY_ACTION_TOOL || call.overflow) continue;
    let args: unknown;
    try { args = JSON.parse(call.arguments); } catch { continue; }
    if (isObject(args) && Object.keys(args).length === 1 && typeof args.action === "string" && allowed.includes(args.action)) return args.action;
  }
  return null;
}

/**
 * Reads one streamed reply. Text and tool calls are read independently, and one valid action is
 * handed on as soon as its arguments are complete, before the reply ends.
 */
class RoundReader {
  done = false;
  responseError = false;
  refused = false;
  truncated = false;
  /** Some text reached the window. */
  said = false;
  /** The reply's text exactly as the model sent it, before anything was taken out; for developer mode. */
  raw = "";
  readonly tools = new ToolCallCollector();
  readonly web = new WebResult();
  private readonly reply = new ReplyText();
  private actionSent = false;

  constructor(private readonly emit: Emit, private readonly allowedActions: readonly string[], private readonly webMode: boolean) {}

  read(data: string): void {
    const line = parseStreamData(data);
    if (line.kind === "done") { this.done = true; return; }
    if (line.kind === "error") { this.responseError = true; return; }
    if (line.kind === "refused") { this.refused = true; return; }
    if (line.kind !== "chunk" || this.done || this.responseError || this.refused) return;
    this.raw += line.text;
    this.truncated ||= line.truncated;
    this.show(this.webMode ? line.text : this.reply.push(line.text));
    if (this.webMode) {
      const progress = this.web.update(webDelta(line.choice));
      if (progress) this.emit("web-progress", progress);
      return;
    }
    if (line.tools.length === 0) return;
    this.tools.add(line.tools);
    if (this.actionSent || this.truncated) return;
    const action = readyAction(this.tools.calls, this.allowedActions);
    if (action) { this.actionSent = true; this.emit("action", action); }
  }

  /** The text held back until the end, such as a possible leaked call. */
  finish(): void {
    if (!this.refused) this.show(this.reply.finish());
  }

  succeeded(end: RoundEnd): boolean {
    return this.done && !this.responseError && !this.refused && end.ok;
  }

  private show(text: string): void {
    if (!text) return;
    this.said ||= text.trim() !== "";
    this.emit("delta", text);
  }
}

/** What the window gets for each call it saves, so it can tell the user about the ones it could not save. */
function toolPayloads(tools: ToolCallCollector): string[] {
  const payloads = tools.calls
    .filter((call) => !LOOKUP_TOOLS.includes(call.name) && call.name !== PLAY_ACTION_TOOL && (call.name !== "" || call.overflow))
    .map((call) => JSON.stringify({ name: call.name, arguments: call.arguments, overflow: call.overflow }));
  return tools.droppedCount > 0 ? [...payloads, JSON.stringify({ name: "", arguments: "", dropped: tools.droppedCount })] : payloads;
}

interface Run { cancelled: boolean; dispatched: boolean }
const runs = new Map<string, Run>();

function send(event: ChatEvent): void {
  for (const listener of listeners) listener(event);
}

export interface RunOptions {
  /** A webpage, search or picture turn. */
  mode?: WebMode;
  /** The saved lists the lookups answer from. */
  lists: Lists;
  /** Pet actions the reply may play. */
  actions: readonly string[];
  /** Developer mode keeps the requests. */
  record: boolean;
}

/**
 * Sends a request and streams the reply to this window's listeners. Resolves once the request is on its way;
 * rejects when it cannot start. Each window answers one message at a time.
 */
export async function startRun(id: string, body: RequestBody, options: RunOptions): Promise<void> {
  if ([...runs.values()].some((run) => !run.cancelled)) throw new Error("上一条还在回复，稍等一下。");
  const run: Run = { cancelled: false, dispatched: false };
  const emit: Emit = (kind, text) => {
    if (run.cancelled) return;
    if (kind === "action") run.dispatched = true;
    send({ id, kind, text });
  };
  const reader = new RoundReader(emit, options.actions, Boolean(options.mode));
  runs.set(id, run);
  let ended: Promise<RoundEnd>;
  try { ({ ended } = await startRound(id, body, (data) => reader.read(data))); }
  catch (error) { runs.delete(id); throw error; }
  // A stop asked for while the request was starting must still stop it.
  if (run.cancelled) void llmPlatform.cancel(id).catch(() => {});
  const record = options.record ? new RequestRecord(id) : null;
  void finishRun(id, run, body, reader, ended, options, record, emit)
    .catch((error: unknown) => { console.error("The reply could not finish", error); runs.delete(id); send({ id, kind: "error", text: failureMessage(null) }); });
}

async function finishRun(id: string, run: Run, body: RequestBody, reader: RoundReader, ended: Promise<RoundEnd>, options: RunOptions, record: RequestRecord | null, emit: Emit): Promise<void> {
  const end = await ended;
  run.cancelled ||= end.cancelled;
  reader.finish();
  const succeeded = reader.succeeded(end);
  record?.add(body, reader.raw, reader.tools.calls, succeeded, end.status);
  if (!options.mode && succeeded && !run.cancelled) {
    if (!run.dispatched && reader.tools.calls.some((call) => call.name === PLAY_ACTION_TOOL)) {
      // A truncated, invalid or unavailable action must not become a different action.
      emit("action", "");
    }
    const lookup = lookupResults(reader.tools.calls, options.lists);
    if (lookup.local) emit("delta", `${reader.said ? "\n\n" : ""}${clipLocalLookup(lookup.local)}`);
    if (lookup.sources) {
      if (reader.said || lookup.local) emit("delta", "\n\n");
      await synthesize(id, run, lookupRequest(body, lookup.sources), record, emit);
    }
  }
  runs.delete(id);
  const mode = options.mode;
  if (run.cancelled) send({ id, kind: "cancelled", text: "" });
  else if (reader.refused) send({ id, kind: mode ? "web-error" : "error", text: "这条内容未能通过 DeepSeek 的审核。" });
  else if (!succeeded) send({ id, kind: "error", text: failureMessage(isSuccess(end.status) ? null : end.status) });
  else if (mode === "open" && !reader.web.readPage()) send({ id, kind: "web-error", text: "没能读取网页，请检查链接是否能直接打开，或复制正文到聊天里。" });
  else if (mode === "search" && !reader.web.foundSources()) send({ id, kind: "web-error", text: "没找到可引用的网页，试着换个问法再搜。" });
  else {
    if (mode) send({ id, kind: "web-result", text: JSON.stringify(reader.web.payload(reader.truncated)) });
    else for (const payload of toolPayloads(reader.tools)) send({ id, kind: "tool", text: payload });
    // "length" tells the window the reply was cut off at the token limit.
    send({ id, kind: "done", text: reader.truncated ? "length" : "" });
  }
}

/** A further request that answers from the looked-up records, streaming into the same reply. */
async function synthesize(id: string, run: Run, body: RequestBody, record: RequestRecord | null, emit: Emit): Promise<void> {
  if (run.cancelled) return;
  const reader = new RoundReader(emit, [], false);
  try {
    const { ended } = await startRound(id, body, (data) => reader.read(data));
    if (run.cancelled) void llmPlatform.cancel(id).catch(() => {});
    const end = await ended;
    run.cancelled ||= end.cancelled;
    reader.finish();
    record?.add(body, reader.raw, reader.tools.calls, reader.succeeded(end), end.status);
    if (!reader.succeeded(end) || !reader.said) emit("delta", LOOKUP_UNAVAILABLE);
  } catch (error) {
    console.error("The lookup request could not start", error);
    emit("delta", LOOKUP_UNAVAILABLE);
  }
}

/** Stops a reply; the window then gets `cancelled`. */
export async function cancelRun(id: string): Promise<void> {
  const run = runs.get(id);
  if (run) run.cancelled = true;
  await llmPlatform.cancel(id);
}

/** Listens to the replies this window asked for. */
export async function subscribeRuns(handler: (event: ChatEvent) => void): Promise<() => void> {
  await ensureTransport();
  listeners.add(handler);
  return () => { listeners.delete(handler); };
}
