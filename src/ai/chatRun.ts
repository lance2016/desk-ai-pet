import type { WebMode } from "../chat/ReadLinks";
import { llmPlatform } from "../platform/llm";
import { ReplyText } from "./deepseek/leaks";
import { webDelta, WebResult, type WebProgress } from "./deepseek/web";
import { DEEPSEEK, failureMessage, isSuccess } from "./provider";
import { recordStat, RequestRecord, type RequestKind } from "./requestLog";
import { nextRound, type AnsweredCall, type RequestBody } from "./requests";
import { failed, offeredSkills, offeredTools, type Skill, type Tool, type ToolCall as RunningCall, type ToolOutcome } from "./skill";
import { callArguments, MAX_TOOL_CALLS, parseStreamData, ToolCallCollector, type ToolCall, type Usage } from "./stream";
import type { ChatContext, ChatEvent } from "./types";

/** Requests one reply may make: the first, and up to three more when the model has to read what its tools found. */
const MAX_ROUNDS = 4;
const CANNOT_GO_ON = "查到了记录，但暂时没法接着处理。可以再说一次，或者在提醒、备忘面板里操作。";
const NOT_DONE = "有的没做成，看下面的说明";
const ONE_EARLY_CALL = "这次回复已经做过一个动作，没有再做。";

interface RoundEnd { status: number | null; ok: boolean; cancelled: boolean }

/** The streamed requests of this window, by request id, and the window parts listening to replies. */
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

/** Reads one streamed round. Text and tool calls are read independently, so a tool can start before the round ends. */
class RoundReader {
  done = false;
  responseError = false;
  refused = false;
  truncated = false;
  /** Some words reached the window in this round. */
  said = false;
  /** The round's words as shown, for the next round's history. */
  text = "";
  /** The round's text exactly as the model sent it, before anything was taken out; for developer mode. */
  raw = "";
  readonly tools = new ToolCallCollector();
  readonly web = new WebResult();
  /** When the request was sent; the reader is made just before. */
  readonly startedAt = Date.now();
  /** When the first words or tool call came. */
  firstTokenAt: number | null = null;
  /** Tokens used, from the last chunk. */
  usage: Usage | null = null;
  private readonly reply = new ReplyText();

  constructor(
    private readonly show: (text: string) => void,
    private readonly progress: (progress: WebProgress) => void,
    private readonly webMode: boolean,
    private readonly onTools: (calls: readonly ToolCall[]) => void,
  ) {}

  read(data: string): void {
    const line = parseStreamData(data);
    if (line.kind === "done") { this.done = true; return; }
    if (line.kind === "error") { this.responseError = true; return; }
    if (line.kind === "refused") { this.refused = true; return; }
    if (line.kind !== "chunk" || this.done || this.responseError || this.refused) return;
    if (line.usage) this.usage = line.usage;
    if (this.firstTokenAt === null && (line.text || line.tools.length > 0)) this.firstTokenAt = Date.now();
    this.raw += line.text;
    this.truncated ||= line.truncated;
    this.emit(this.webMode ? line.text : this.reply.push(line.text));
    if (this.webMode) {
      const progress = this.web.update(webDelta(line.choice));
      if (progress) this.progress(progress);
      return;
    }
    if (line.tools.length === 0) return;
    this.tools.add(line.tools);
    if (!this.truncated) this.onTools(this.tools.calls);
  }

  /** The text held back until the end, such as a possible leaked call. */
  finish(): void {
    if (!this.refused) this.emit(this.reply.finish());
  }

  succeeded(end: RoundEnd): boolean {
    return this.done && !this.responseError && !this.refused && end.ok;
  }

  private emit(text: string): void {
    if (!text) return;
    this.said ||= text.trim() !== "";
    this.text += text;
    this.show(text);
  }
}

/** Arguments that are already a complete JSON object, or null. */
function completeArguments(call: ToolCall): Record<string, unknown> | null {
  if (call.overflow || !call.arguments.trim()) return null;
  try {
    const value: unknown = JSON.parse(call.arguments);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

interface Run {
  cancelled: boolean;
  /** Some words reached the window, in any round. */
  said: boolean;
  /** The next words start a new block of the reply: a blank line goes before them. */
  breakBefore: boolean;
  /** A tool that starts early has run in this reply; only one does. */
  earlyStarted: boolean;
  /** What each tool said for itself, for a reply in which the model said nothing. */
  confirmations: string[];
}
const runs = new Map<string, Run>();

function send(event: ChatEvent): void {
  for (const listener of listeners) listener(event);
}

/** The tools a chat turn offers, with the context they work in. */
export interface ToolSetup { context: ChatContext; skills: readonly Skill[] }

export interface RunOptions {
  /** A webpage, search or picture turn: no local tools. */
  mode?: WebMode;
  /** A chat turn with local tools. */
  tools?: ToolSetup;
  /** What the request is for, in the request records; a webpage turn is always "web". */
  kind: Exclude<RequestKind, "greeting" | "test">;
  /** Developer mode keeps the requests. */
  record: boolean;
}

/** Everything one reply needs while it runs. */
class Reply {
  readonly run: Run = { cancelled: false, said: false, breakBefore: false, earlyStarted: false, confirmations: [] };
  private readonly toolsByName: Map<string, Tool>;
  /** Tools of this turn's skills that are not offered, so a call to one can say it is turned off. */
  private readonly withheld: Map<string, Tool>;
  private readonly call: RunningCall;
  private readonly record: RequestRecord | null;
  private started = new Map<number, Promise<ToolOutcome>>();

  constructor(private readonly id: string, private readonly options: RunOptions) {
    const setup = options.tools;
    this.toolsByName = new Map(setup ? offeredSkills(setup.skills, setup.context).flatMap((skill) => offeredTools(skill, setup.context).map((tool) => [tool.name, tool] as const)) : []);
    this.withheld = new Map(setup ? setup.skills.flatMap((skill) => skill.tools).filter((tool) => !this.toolsByName.has(tool.name)).map((tool) => [tool.name, tool] as const) : []);
    this.call = { requestId: id, context: setup?.context ?? { now: "", timestamp: "", timeZone: "", actions: [], facts: { mine: [], learned: [], learning: false } }, memo: new Map() };
    this.record = options.record ? new RequestRecord(id) : null;
  }

  reader(): RoundReader {
    this.started = new Map();
    return new RoundReader((text) => this.show(text), (progress) => this.event("web-progress", progress), Boolean(this.options.mode), (calls) => this.startEarly(calls));
  }

  /** Words for the window; a new block of the reply gets a blank line before it. */
  show(text: string): void {
    if (this.run.cancelled || !text) return;
    const lead = this.run.breakBefore && text.trim() ? "\n\n" : "";
    if (text.trim()) { this.run.breakBefore = false; this.run.said = true; }
    this.event("delta", lead + text);
  }

  event(kind: Exclude<ChatEvent["kind"], "effect">, text: string): void {
    if (!this.run.cancelled) send({ id: this.id, kind, text });
  }

  /** The reply is over: this window may ask again. */
  final(kind: Exclude<ChatEvent["kind"], "effect">, text: string): void {
    runs.delete(this.id);
    send({ id: this.id, kind, text });
  }

  private runTool(tool: Tool, args: Record<string, unknown>): Promise<ToolOutcome> {
    return Promise.resolve()
      .then(() => tool.run(args, this.call))
      .catch((error: unknown) => { console.error(`The ${tool.name} tool failed`, error); return failed("这一步没做成", { confirmation: NOT_DONE }); });
  }

  /** Starts a tool marked `early` as soon as its arguments are complete; one per reply. */
  private startEarly(calls: readonly ToolCall[]): void {
    calls.forEach((call, index) => {
      const tool = this.toolsByName.get(call.name);
      if (this.run.earlyStarted || this.started.has(index) || !tool?.early) return;
      const args = completeArguments(call);
      if (!args || !tool.early.ready(args, this.call.context)) return;
      this.run.earlyStarted = true;
      this.started.set(index, this.runTool(tool, args));
    });
  }

  private runAtEnd(call: ToolCall): Promise<ToolOutcome> {
    if (call.overflow) return Promise.resolve(failed("这条没做成：内容太长", { confirmation: NOT_DONE }));
    const tool = this.toolsByName.get(call.name);
    const withheld = this.withheld.get(call.name);
    // The model sometimes calls a tool it was not given; say why nothing happened.
    if (!tool && withheld) return Promise.resolve(failed(`「${withheld.label}」在设置里关着，没有做`));
    if (!tool) return Promise.resolve(failed("没看懂这条请求", { confirmation: NOT_DONE }));
    // Unreadable arguments go to the tool as none, so it says in its own words what is missing.
    const args = callArguments(call) ?? {};
    if (tool.early) {
      if (this.run.earlyStarted) return Promise.resolve({ result: ONE_EARLY_CALL });
      this.run.earlyStarted = true;
    }
    return this.runTool(tool, args);
  }

  /** Shows what a call did: lines under the reply always (it happened), a list in the reply while it runs. */
  private report(outcome: ToolOutcome): void {
    for (const line of outcome.lines ?? []) send({ id: this.id, kind: "effect", line });
    if (outcome.shown) { this.run.breakBefore = this.run.said; this.show(outcome.shown); }
    if (outcome.confirmation) this.run.confirmations.push(outcome.confirmation);
  }

  /** Runs the round's calls in order; returns them answered, and whether the model has to read the results. */
  async runCalls(reader: RoundReader): Promise<{ answered: AnsweredCall[]; needsModel: boolean }> {
    const answered: AnsweredCall[] = [];
    let needsModel = false;
    for (const [index, call] of reader.tools.calls.entries()) {
      if (!call.name && !call.overflow) continue;
      const outcome = await (this.started.get(index) ?? this.runAtEnd(call));
      this.report(outcome);
      answered.push({ call, result: outcome.result });
      needsModel ||= outcome.needsModel === true;
    }
    if (reader.tools.droppedCount > 0) this.report(failed(`一次最多处理 ${MAX_TOOL_CALLS} 件，后面 ${reader.tools.droppedCount} 件没做`, { confirmation: NOT_DONE }));
    return { answered, needsModel };
  }

  /** Reports the tools that started early in a round that then failed or was stopped: what they did still happened. */
  async settleEarly(): Promise<void> {
    for (const outcome of await Promise.all(this.started.values())) this.report(outcome);
    this.started = new Map();
  }

  /** Ends a reply that worked; the tools speak for it when the model said nothing. */
  finishReply(truncated: boolean): void {
    if (!this.run.said && this.run.confirmations.length > 0) this.show([...new Set(this.run.confirmations)].join("。"));
    // "length" tells the window the reply was cut off at the token limit.
    this.final("done", truncated ? "length" : "");
  }

  /** Every round leaves a short row; developer mode keeps it whole as well. */
  addRound(body: RequestBody, reader: RoundReader, end: RoundEnd): void {
    const outcome = { model: body.model, startedAt: reader.startedAt, ok: reader.succeeded(end), status: end.status, firstTokenAt: reader.firstTokenAt, usage: reader.usage };
    recordStat(this.options.kind, outcome);
    this.record?.add(body, reader.raw, reader.tools.calls, outcome);
  }
}

/**
 * Sends a request and streams the reply to this window's listeners. When the model's tools found something
 * it has to read, the reply goes on with another request. Resolves once the first request is on its way;
 * rejects when it cannot start. Each window answers one message at a time.
 */
export async function startRun(id: string, body: RequestBody, options: RunOptions): Promise<void> {
  if ([...runs.values()].some((run) => !run.cancelled)) throw new Error("上一条还在回复，稍等一下。");
  const reply = new Reply(id, options);
  const reader = reply.reader();
  runs.set(id, reply.run);
  let ended: Promise<RoundEnd>;
  try { ({ ended } = await startRound(id, body, (data) => reader.read(data))); }
  catch (error) { runs.delete(id); throw error; }
  // A stop asked for while the request was starting must still stop it.
  if (reply.run.cancelled) void llmPlatform.cancel(id).catch(() => {});
  void finishRun(id, reply, body, reader, ended, options)
    .catch((error: unknown) => { console.error("The reply could not finish", error); reply.final("error", failureMessage(null)); });
}

async function finishRun(id: string, reply: Reply, firstBody: RequestBody, firstReader: RoundReader, firstEnded: Promise<RoundEnd>, options: RunOptions): Promise<void> {
  const { run } = reply;
  let body = firstBody;
  let reader = firstReader;
  let ended = firstEnded;
  for (let round = 1; ; round += 1) {
    const end = await ended;
    run.cancelled ||= end.cancelled;
    reader.finish();
    reply.addRound(body, reader, end);
    if (run.cancelled || !reader.succeeded(end)) await reply.settleEarly();
    if (run.cancelled) { reply.final("cancelled", ""); return; }
    if (!reader.succeeded(end)) {
      if (round > 1) { reply.show(CANNOT_GO_ON); reply.finishReply(false); return; }
      if (reader.refused) reply.final(options.mode ? "web-error" : "error", "这条内容未能通过 DeepSeek 的审核。");
      // A reply that broke off after a good start is an interruption, not a status problem.
      else reply.final("error", failureMessage(isSuccess(end.status) ? null : end.status));
      return;
    }
    if (options.mode) { finishWebReply(reply, reader, options.mode); return; }
    if (round > 1 && !reader.said && reader.tools.calls.length === 0) reply.show(CANNOT_GO_ON);
    const { answered, needsModel } = await reply.runCalls(reader);
    if (run.cancelled) { reply.final("cancelled", ""); return; }
    if (!needsModel || round >= MAX_ROUNDS) { reply.finishReply(reader.truncated); return; }
    body = nextRound(body, reader.text, answered, round + 1 >= MAX_ROUNDS);
    run.breakBefore = run.said;
    const next = reply.reader();
    try { ({ ended } = await startRound(id, body, (data) => next.read(data))); }
    catch (error) { console.error("The next round could not start", error); reply.show(CANNOT_GO_ON); reply.finishReply(false); return; }
    if (run.cancelled) void llmPlatform.cancel(id).catch(() => {});
    reader = next;
  }
}

function finishWebReply(reply: Reply, reader: RoundReader, mode: WebMode): void {
  if (mode === "open" && !reader.web.readPage()) { reply.final("web-error", "没能读取网页，请检查链接是否能直接打开，或复制正文到聊天里。"); return; }
  if (mode === "search" && !reader.web.foundSources()) { reply.final("web-error", "没找到可引用的网页，试着换个问法再搜。"); return; }
  reply.event("web-result", JSON.stringify(reader.web.payload(reader.truncated)));
  reply.final("done", reader.truncated ? "length" : "");
}

/** Stops a reply; the window then gets `cancelled`. Lines for what the tools already did still come. */
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
