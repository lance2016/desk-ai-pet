import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";

/** Must match CAPTURED_EVENT and `set_capture_enabled` in src-tauri/src/capture.rs. */
const CAPTURED_EVENT = "pet://captured";

/** Pictures of the pet's own windows. In a plain browser there are none. */
export const capturePlatform = {
  /** Lets coding agents take pictures with `ai-pet --capture`, or stops them. */
  async setEnabled(enabled: boolean): Promise<void> {
    if (isTauri()) await invoke("set_capture_enabled", { enabled });
  },
  /** Calls `handler` once "3 秒后截图" in the pet menu has copied the picture, or failed to. Returns an unsubscribe function. */
  onCaptured(handler: (copied: boolean) => void): () => void {
    if (!isTauri()) return () => {};
    const unlisten = listen(CAPTURED_EVENT, (event) => {
      const parsed = z.boolean().safeParse(event.payload);
      if (parsed.success) handler(parsed.data);
      else console.warn("Ignoring a malformed capture result", parsed.error);
    });
    return () => { unlisten.then((stop) => stop()).catch((error: unknown) => console.error("Failed to stop listening for captures", error)); };
  },
};
