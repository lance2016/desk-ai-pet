import { z } from "zod";
import { llmPlatform } from "../platform/llm";
import type { RequestBody } from "./requests";
import type { ToolCall } from "./stream";

const roundSchema = z.object({ request: z.unknown(), reply: z.string(), toolCalls: z.array(z.object({ name: z.string(), arguments: z.string() })), ok: z.boolean(), status: z.number().nullable() });
const logSchema = z.array(z.object({
  id: z.string(),
  /** The window that asked: "chat" is the chat window, the pet window's quick chat is "main". */
  window: z.string(),
  at: z.number(),
  /** Every request made for one reply: a scoped lookup can add a synthesis request. */
  rounds: z.array(roundSchema),
}));
/** Recent chat requests, newest first, as kept in developer mode. Native memory only. */
export type ChatRequestLog = z.infer<typeof logSchema>;
type Round = z.infer<typeof roundSchema>;

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

  add(body: RequestBody, reply: string, calls: readonly ToolCall[], ok: boolean, status: number | null): void {
    this.rounds.push({ request: withoutPicture(body), reply, toolCalls: calls.map(({ name, arguments: args }) => ({ name, arguments: args })), ok, status });
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
