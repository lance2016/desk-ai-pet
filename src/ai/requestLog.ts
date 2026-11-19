import { z } from "zod";
import { llmPlatform } from "../platform/llm";
import type { RequestBody } from "./requests";
import type { ToolCall, Usage } from "./stream";

const usageSchema = z.object({ promptTokens: z.number(), completionTokens: z.number(), cacheHitTokens: z.number().nullable() });
const roundSchema = z.object({
  request: z.unknown(),
  reply: z.string(),
  toolCalls: z.array(z.object({ name: z.string(), arguments: z.string() })),
  ok: z.boolean(),
  status: z.number().nullable(),
  /** From sending the request to its end. */
  durationMs: z.number(),
  /** From sending the request to the first words or tool call; null when none came. */
  firstTokenMs: z.number().nullable(),
  usage: usageSchema.nullable(),
});
const logSchema = z.array(z.object({
  id: z.string(),
  /** The window that asked: "chat" is the chat window, the pet window's quick chat is "main". */
  window: z.string(),
  at: z.number(),
  /** Every request made for one reply: a scoped lookup can add a synthesis request. */
  rounds: z.array(roundSchema),
}));
/** Recent chat requests, newest first, as kept in developer mode. */
export type ChatRequestLog = z.infer<typeof logSchema>;
type Round = z.infer<typeof roundSchema>;

/** What a request was for: a chat turn with tools, a webpage turn, a text task, a greeting, or a connection test. */
export type RequestKind = "chat" | "web" | "text" | "greeting" | "test";

/** How one request went, as every request records it: no content, only timing and tokens. */
export interface RequestOutcome {
  model: string;
  startedAt: number;
  ok: boolean;
  status: number | null;
  firstTokenAt: number | null;
  usage: Usage | null;
}

/** Writes the short row every request leaves. A failure is logged; the reply carries on. */
export function recordStat(kind: RequestKind, outcome: RequestOutcome, now = Date.now()): void {
  const { model, startedAt, ok, status, firstTokenAt, usage } = outcome;
  llmPlatform.addStat({
    at: startedAt,
    kind,
    window: llmPlatform.windowLabel(),
    model,
    ok,
    status,
    durationMs: Math.max(0, now - startedAt),
    firstTokenMs: firstTokenAt === null ? null : Math.max(0, firstTokenAt - startedAt),
    promptTokens: usage?.promptTokens ?? null,
    completionTokens: usage?.completionTokens ?? null,
    cacheHitTokens: usage?.cacheHitTokens ?? null,
  }).catch((error: unknown) => console.warn("Could not record the request", error));
}

/** A picture is replaced by a mark: its bytes never go into the log. */
function withoutPicture(body: RequestBody): RequestBody {
  return {
    ...body,
    messages: body.messages.map((message) => (Array.isArray(message.content)
      ? { ...message, content: message.content.map((part: unknown) => (typeof part === "object" && part !== null && "image_url" in part ? { ...part, image_url: { url: "[Image omitted]" } } : part)) }
      : message)),
  };
}

/** The log entry of one reply in developer mode; each request made for it is added when it ends. */
export class RequestRecord {
  private readonly rounds: Round[] = [];
  private readonly at = Date.now();

  constructor(private readonly id: string) { this.save(); }

  add(body: RequestBody, reply: string, calls: readonly ToolCall[], outcome: RequestOutcome, now = Date.now()): void {
    this.rounds.push({
      request: withoutPicture(body),
      reply,
      toolCalls: calls.map(({ name, arguments: args }) => ({ name, arguments: args })),
      ok: outcome.ok,
      status: outcome.status,
      durationMs: Math.max(0, now - outcome.startedAt),
      firstTokenMs: outcome.firstTokenAt === null ? null : Math.max(0, outcome.firstTokenAt - outcome.startedAt),
      usage: outcome.usage,
    });
    this.save();
  }

  private save(): void {
    const entry = { id: this.id, window: llmPlatform.windowLabel(), at: this.at, rounds: this.rounds };
    llmPlatform.putLogEntry(entry).catch((error: unknown) => console.warn("Could not record the request", error));
  }
}

export async function readRequestLog(): Promise<ChatRequestLog> {
  return logSchema.parse(await llmPlatform.logEntries());
}
