import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { z } from "zod";

/**
 * The model channel in `src-tauri/src/llm.rs` (keys, requests; must match `STREAM_EVENT` there)
 * and the request records in `src-tauri/src/request_log.rs`.
 */
const STREAM_EVENT = "pet://llm-stream";

const streamSchema = z.discriminatedUnion("kind", [
  /** One `data:` line of a streamed reply. */
  z.object({ id: z.string(), kind: z.literal("data"), data: z.string() }),
  /** The request is over: its HTTP status, whether curl finished cleanly, and whether it was stopped. */
  z.object({ id: z.string(), kind: z.literal("end"), status: z.number().nullable(), ok: z.boolean(), cancelled: z.boolean() }),
]);
export type StreamEvent = z.infer<typeof streamSchema>;

const completionSchema = z.object({ status: z.number().nullable(), ok: z.boolean(), body: z.string() });
export type Completion = z.infer<typeof completionSchema>;

function requireNative() { if (!isTauri()) throw new Error("请在桌面应用中使用聊天功能。"); }

export const llmPlatform = {
  async keyStatus(provider: string): Promise<boolean> { requireNative(); return invoke("llm_key_status", { provider }); },
  async saveKey(provider: string, key: string): Promise<void> { requireNative(); await invoke("llm_save_key", { provider, key }); },
  async clearKey(provider: string): Promise<void> { requireNative(); await invoke("llm_clear_key", { provider }); },
  /** Starts a streamed request; its lines arrive through `subscribe`. Rejects when it cannot start, e.g. without a key. */
  async stream(provider: string, requestId: string, body: object): Promise<void> { requireNative(); await invoke("llm_stream", { provider, requestId, body }); },
  async complete(provider: string, body: object): Promise<Completion> { requireNative(); return completionSchema.parse(await invoke("llm_complete", { provider, body })); },
  async cancel(requestId: string): Promise<void> { requireNative(); await invoke("llm_cancel", { requestId }); },
  async subscribe(handler: (event: StreamEvent) => void): Promise<() => void> {
    requireNative();
    return listen(STREAM_EVENT, (event) => { const parsed = streamSchema.safeParse(event.payload); if (parsed.success) handler(parsed.data); });
  },
  /** "chat" for the chat window, "main" for the pet window's quick chat. */
  windowLabel(): string { return isTauri() ? getCurrentWindow().label : "browser"; },
  /** The short row every request leaves; kept by `src-tauri/src/request_log.rs`. */
  async addStat(stat: object): Promise<void> { requireNative(); await invoke("llm_stats_add", { stat }); },
  async putLogEntry(entry: object): Promise<void> { requireNative(); await invoke("llm_log_put", { entry }); },
  async logEntries(): Promise<unknown> { requireNative(); return invoke("llm_log_list"); },
  async clearLog(): Promise<void> { requireNative(); await invoke("llm_log_clear"); },
};
