import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";
import { AGENT_EVENTS, type AgentReport } from "../types";

/** Must match EVENT and the commands in src-tauri/src/agent_hooks.rs and claude_settings.rs. */
const AGENT_EVENT = "pet://agent";

/** The native side cuts a hook event down to these; checked again here, as anything outside the window is. */
const reportSchema = z.object({
  event: z.enum(AGENT_EVENTS),
  session: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(56),
  // The native side cuts names to 64 characters; in UTF-16 that is at most twice as many.
  project: z.string().max(128),
  tool: z.string().min(1).max(128).optional(),
  notification: z.string().min(1).max(64).optional(),
  error: z.string().min(1).max(64).optional(),
  subagent: z.boolean().optional(),
}) satisfies z.ZodType<AgentReport>;

const stateSchema = z.object({
  /** Our hooks are in Claude Code's settings. */
  connected: z.boolean(),
  /** They point at this copy of AI Pet; false after the app moved. */
  current: z.boolean(),
  /** When a hook last reported, in milliseconds; null if none since the pet started. */
  lastReportAt: z.number().nullable(),
});

export type ClaudeHooksState = z.infer<typeof stateSchema>;

function requireNative() { if (!isTauri()) throw new Error("需要在桌面应用中使用。"); }

/** Claude Code's status, from its hooks. In a plain browser nothing is reported and nothing is connected. */
export const agentPlatform = {
  /** Calls `handler` for each hook event. Returns an unsubscribe function. */
  onReport(handler: (report: AgentReport) => void): () => void {
    if (!isTauri()) return () => {};
    const unlisten = listen(AGENT_EVENT, (event) => {
      const parsed = reportSchema.safeParse(event.payload);
      if (parsed.success) handler(parsed.data);
      else console.warn("Ignoring a malformed agent report", parsed.error);
    });
    return () => { unlisten.then((stop) => stop()).catch((error: unknown) => console.error("Failed to stop listening for agent reports", error)); };
  },
  /** Whether the session's transcript shows the user interrupted it after `since` (milliseconds). */
  async interrupted(session: string, since: number): Promise<boolean> {
    return isTauri() ? z.boolean().parse(await invoke("agent_interrupted", { session, since })) : false;
  },
  async state(): Promise<ClaudeHooksState> {
    return isTauri() ? stateSchema.parse(await invoke("claude_hooks_state")) : { connected: false, current: false, lastReportAt: null };
  },
  /** Adds our hooks to ~/.claude/settings.json, after a backup. Rejects with a message for the user. */
  async connect(): Promise<void> { requireNative(); await invoke("claude_hooks_connect"); },
  /** Takes only our hooks out again. Rejects with a message for the user. */
  async disconnect(): Promise<void> { requireNative(); await invoke("claude_hooks_disconnect"); },
};
