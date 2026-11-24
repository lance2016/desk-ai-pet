import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { z } from "zod";
import type { ExportFormat } from "../dubbing/DubbingStore";

/** Must match `FORMAT_HEADER` in `src-tauri/src/dubbing.rs`. */
const FORMAT_HEADER = "x-dubbing-format";

function requireNative() {
  if (!isTauri()) throw new Error("导出音频需要在桌面应用中使用。");
}

export const dubbingPlatform = {
  /** Turns the "配音…" menu item on or off; off also closes the window. */
  async setEnabled(enabled: boolean): Promise<void> {
    if (isTauri()) await invoke("set_dubbing_enabled", { enabled });
  },
  /** Asks where to save `wav` and saves it as `format`. The file name, or null when the user cancels. */
  async exportAudio(wav: Uint8Array, format: ExportFormat): Promise<string | null> {
    requireNative();
    return z.string().nullable().parse(await invoke("dubbing_export", wav, { headers: { [FORMAT_HEADER]: format } }));
  },
  /**
   * Holds back every close of the dubbing window (⌘W, the close button, turning the tool off) and
   * closes it only when `mayClose` agrees. Must match `dubbing_discard` in `src-tauri/src/dubbing.rs`.
   */
  onCloseRequested(mayClose: () => Promise<boolean>): () => void {
    if (!isTauri()) return () => {};
    const stop = getCurrentWindow().onCloseRequested(async (event) => {
      // Without this the page would destroy the window itself, which its permissions do not allow.
      event.preventDefault();
      try { if (await mayClose()) await invoke("dubbing_discard"); }
      catch (error) { console.error("Could not close the dubbing window", error); }
    });
    return () => { stop.then((unlisten) => unlisten()).catch((error: unknown) => console.warn("Could not stop holding the dubbing window open", error)); };
  },
  /** Saves subtitles beside the audio just exported, under the same name. The file name. */
  async exportSubtitles(text: string): Promise<string> {
    requireNative();
    return z.string().parse(await invoke("dubbing_export_subtitles", { text }));
  },
};
