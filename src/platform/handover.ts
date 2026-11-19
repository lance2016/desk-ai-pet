import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";

/** Must match `COPIED_EVENT` and `take_copied` in `src-tauri/src/handover.rs`. */
const COPIED_EVENT = "pet://copied";
const copiedSchema = z.string().min(1).nullable();

/** Text the user copies for the pet. The native side reads it only when `takeCopied` asks. */
export const handoverPlatform = {
  /** Called when something was copied in another app; not called for copies password managers mark as private. */
  async onCopied(handler: () => void): Promise<() => void> {
    return isTauri() ? listen(COPIED_EVENT, handler) : () => {};
  },
  /** What was copied in the last minute, read now; null when there is none, and outside the desktop app. */
  async takeCopied(): Promise<string | null> {
    if (!isTauri()) return null;
    return copiedSchema.parse(await invoke("take_copied"));
  },
};
