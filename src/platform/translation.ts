import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface Selection { text: string; status: "ok" | "empty" | "permission"; auto?: boolean; result?: string }
export const translationPlatform = {
  async setShortcut(shortcut: string | null): Promise<void> { if (isTauri()) await invoke("set_translation_shortcut", { shortcut }); },
  async open(): Promise<void> { if (isTauri()) await invoke("open_translation"); },
  async setSelectionFloat(enabled: boolean): Promise<void> { if (isTauri()) await invoke("set_selection_float", { enabled }); },
  async translateSelection(result?: string): Promise<void> { if (isTauri()) await invoke("translate_floating_selection", { result: result ?? null }); },
  async expandSelection(): Promise<string> { return isTauri() ? invoke("expand_selection_float") : ""; },
  async closeSelection(): Promise<void> { if (isTauri()) await invoke("close_selection_float"); },
  async onSelectionReset(handler: () => void): Promise<() => void> { return isTauri() ? listen("pet://selection-float-reset", handler) : () => {}; },
  async openAccessibilitySettings(): Promise<void> { if (isTauri()) await invoke("open_accessibility_settings"); },
  async selectionAvailable(): Promise<boolean> { return isTauri() ? invoke("selection_status") : false; },
  async takeSelection(): Promise<Selection | null> { return isTauri() ? invoke("take_translation_selection") : null; },
  async onOpen(handler: () => void): Promise<() => void> { return isTauri() ? listen("pet://translation-open", handler) : () => {}; },
  async onHide(handler: () => void): Promise<() => void> { return isTauri() ? listen("pet://translation-hide", handler) : () => {}; },
};
