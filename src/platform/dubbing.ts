import { invoke, isTauri } from "@tauri-apps/api/core";
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
  /** Saves subtitles beside the audio just exported, under the same name. The file name. */
  async exportSubtitles(text: string): Promise<string> {
    requireNative();
    return z.string().parse(await invoke("dubbing_export_subtitles", { text }));
  },
};
