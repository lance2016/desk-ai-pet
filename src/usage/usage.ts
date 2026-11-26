import { recordWork } from "../worklog/store";

/**
 * The ways into a feature the usage page counts. Each use is a work log event of kind
 * `use_` plus the name, with no text: when it happened, never what was in it.
 */
export const USAGE_FEATURES = [
  "quick_chat", "greeting_reply", "handed", "chat_send", "voice_input", "read_aloud",
  "petted", "quick_action", "greeting",
  "panel_today", "panel_notes", "panel_links", "panel_coding", "panel_translation",
  "link_open", "coding_reveal", "mail_code", "dubbing",
] as const;
export type UsageFeature = (typeof USAGE_FEATURES)[number];

export const usageKind = (feature: UsageFeature) => `use_${feature}` as const;

/**
 * Counts one use of `feature`. Not while developing: `pnpm tauri dev` writes to the installed
 * app's database, and trying things out would read as using them.
 */
export function recordUse(feature: UsageFeature): void {
  if (import.meta.env.DEV) return;
  void recordWork([{ kind: usageKind(feature), text: "", before: null, itemId: null }], "user");
}
