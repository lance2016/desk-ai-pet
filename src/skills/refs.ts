import type { ToolCall } from "../ai/skill";

export type ItemKind = "reminder" | "note";
const PREFIX: Record<ItemKind, string> = { reminder: "r", note: "n" };
const memoKey = (kind: ItemKind) => `refs:${kind}`;

/**
 * Numbers the listed items for this reply ("r1", "r2", …), so the model can name one in a later call.
 * The numbers last only for this reply: tool results are not kept in the chat history.
 */
export function numberItems(call: ToolCall, kind: ItemKind, ids: readonly string[]): string[] {
  const refs = ids.map((_, index) => `${PREFIX[kind]}${index + 1}`);
  call.memo.set(memoKey(kind), new Map(refs.map((ref, index) => [ref, ids[index]])));
  return refs;
}

/** The id behind a number given out earlier in this reply, or null. */
export function itemId(call: ToolCall, kind: ItemKind, ref: unknown): string | null {
  const refs = call.memo.get(memoKey(kind));
  return typeof ref === "string" && refs instanceof Map ? refs.get(ref.trim()) ?? null : null;
}
