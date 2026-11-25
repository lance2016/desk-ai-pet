import { z } from "zod";
import { PERSONA_LIMITS } from "../types";
import { MAX_SCRIPT_CHARS } from "./script";

const DRAFT_KEY = "ai-pet:dubbing-draft:v1";
const ENABLED_KEY = "ai-pet:dubbing-enabled:v1";
const CHANGED = "ai-pet:dubbing-enabled-changed";

export const EXPORT_FORMATS = ["m4a", "wav"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** What the dubbing window keeps after it closes: the words and how to read them, never the audio. */
const draftSchema = z.object({
  text: z.string().max(MAX_SCRIPT_CHARS),
  /** A read-aloud voice id; empty picks the first cloned voice, or a built-in one. */
  voice: z.string().max(64),
  style: z.string().max(PERSONA_LIMITS.voiceStyle),
  format: z.enum(EXPORT_FORMATS),
  subtitles: z.boolean(),
});
export type DubbingDraft = z.infer<typeof draftSchema>;

export const EMPTY_DRAFT: DubbingDraft = { text: "", voice: "", style: "", format: "m4a", subtitles: true };

export function loadDraft(storage: Storage = window.localStorage): DubbingDraft {
  try {
    const parsed = draftSchema.safeParse(JSON.parse(storage.getItem(DRAFT_KEY) ?? "null"));
    return parsed.success ? parsed.data : EMPTY_DRAFT;
  } catch {
    return EMPTY_DRAFT;
  }
}

export function saveDraft(draft: DubbingDraft, storage: Storage = window.localStorage): void {
  storage.setItem(DRAFT_KEY, JSON.stringify(draftSchema.parse(draft)));
}

/** Whether "配音" is in the pet's menu; on until turned off in 设置 › 小工具. */
export function dubbingEnabled(storage: Storage = window.localStorage): boolean {
  return storage.getItem(ENABLED_KEY) !== "false";
}

export function setDubbingEnabled(enabled: boolean, storage: Storage = window.localStorage): void {
  storage.setItem(ENABLED_KEY, String(enabled));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

/** Calls `listener` when the switch changes, in this window or another. */
export function subscribeDubbingEnabled(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === ENABLED_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGED, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGED, listener);
  };
}
