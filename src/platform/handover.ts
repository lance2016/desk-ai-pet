import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";

const handedSchema = z.object({ text: z.string().min(1), source: z.enum(["selection", "clipboard"]) }).nullable();
/** What the user handed the pet as it was called up; see `src-tauri/src/handover.rs`. */
export type HandedText = NonNullable<z.infer<typeof handedSchema>>;

export const handoverPlatform = {
  /**
   * The selected text in the app in front, or else what was copied in the last minute when `clipboard` allows it.
   * Null when there is none, and outside the desktop app.
   */
  async take(clipboard: boolean): Promise<HandedText | null> {
    if (!isTauri()) return null;
    return handedSchema.parse(await invoke("take_handover", { clipboard }));
  },
};
