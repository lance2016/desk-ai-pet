import { utf8Length } from "./text";

/** Calls kept from one reply; the rest are reported to the window as dropped. */
export const MAX_TOOL_CALLS = 8;
/** Room for a full note even when the model escapes every character. */
const MAX_TOOL_ARGUMENT_BYTES = 4_000;

/** One streamed piece of a tool call. Name and arguments arrive split over many packets. */
export interface ToolDelta { index: number; id: string; name: string; arguments: string }

/** Tokens one request used. `cacheHitTokens`: the part of the prompt DeepSeek had cached, which costs less. */
export interface Usage { promptTokens: number; completionTokens: number; cacheHitTokens: number | null }

/** One `data:` line of a streamed reply in the OpenAI chat format. */
export type StreamLine =
  | { kind: "ignore" }
  /**
   * `truncated`: the reply stopped at `max_tokens`. `choice` keeps provider extras such as DeepSeek's webpage tools.
   * `usage`: on the last chunk only, when the request asked for it (`stream_options.include_usage`).
   */
  | { kind: "chunk"; text: string; tools: ToolDelta[]; truncated: boolean; choice: Record<string, unknown>; usage: Usage | null }
  | { kind: "refused" }
  | { kind: "error" }
  | { kind: "done" };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const textAt = (value: unknown): string => (typeof value === "string" ? value : "");
const countAt = (value: unknown): number | null => (Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null);

/** The `usage` object of a reply or its last chunk, or null when it has none. */
export function readUsage(value: unknown): Usage | null {
  if (!isObject(value)) return null;
  const promptTokens = countAt(value.prompt_tokens);
  const completionTokens = countAt(value.completion_tokens);
  if (promptTokens === null || completionTokens === null) return null;
  return { promptTokens, completionTokens, cacheHitTokens: countAt(value.prompt_cache_hit_tokens) };
}

function toolDeltas(delta: Record<string, unknown>): ToolDelta[] {
  if (!Array.isArray(delta.tool_calls)) return [];
  return delta.tool_calls.flatMap((call): ToolDelta[] => {
    if (!isObject(call) || !Number.isSafeInteger(call.index) || (call.index as number) < 0) return [];
    const fn = isObject(call.function) ? call.function : {};
    return [{ index: call.index as number, id: textAt(call.id), name: textAt(fn.name), arguments: textAt(fn.arguments) }];
  });
}

export function parseStreamData(data: string): StreamLine {
  if (data === "[DONE]") return { kind: "done" };
  let packet: unknown;
  try { packet = JSON.parse(data); } catch { return { kind: "ignore" }; }
  if (!isObject(packet)) return { kind: "ignore" };
  if (packet.error !== undefined) return { kind: "error" };
  const choice = Array.isArray(packet.choices) && isObject(packet.choices[0]) ? packet.choices[0] : {};
  if (choice.finish_reason === "content_filter") return { kind: "refused" };
  const delta = isObject(choice.delta) ? choice.delta : {};
  return { kind: "chunk", text: textAt(delta.content), tools: toolDeltas(delta), truncated: choice.finish_reason === "length", choice, usage: readUsage(packet.usage) };
}

/** A tool call put back together from its pieces. */
export interface ToolCall {
  /** The provider's id for the call; a later round answers it by this id. */
  id: string;
  name: string;
  arguments: string;
  /** The arguments grew past the limit; they are dropped instead of cut, since a cut JSON cannot be read anyway. */
  overflow: boolean;
}

/** Puts the tool calls of one reply back together, and counts the ones past the limit. */
export class ToolCallCollector {
  readonly calls: ToolCall[] = [];
  private readonly dropped = new Set<number>();

  add(deltas: readonly ToolDelta[]): void {
    for (const delta of deltas) {
      if (delta.index >= MAX_TOOL_CALLS) { this.dropped.add(delta.index); continue; }
      while (this.calls.length <= delta.index) this.calls.push({ id: "", name: "", arguments: "", overflow: false });
      const call = this.calls[delta.index];
      call.id ||= delta.id;
      call.name += delta.name;
      if (call.overflow) continue;
      if (utf8Length(call.arguments) + utf8Length(delta.arguments) <= MAX_TOOL_ARGUMENT_BYTES) call.arguments += delta.arguments;
      else { call.overflow = true; call.arguments = ""; }
    }
  }

  get droppedCount(): number { return this.dropped.size; }
}

/** The arguments of a complete call as an object, or null when they are not one. Empty arguments count as `{}`. */
export function callArguments(call: ToolCall): Record<string, unknown> | null {
  if (call.overflow) return null;
  if (!call.arguments.trim()) return {};
  try { const value: unknown = JSON.parse(call.arguments); return isObject(value) ? value : null; }
  catch { return null; }
}
