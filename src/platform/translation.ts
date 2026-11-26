import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** `copied`: no selection could be read, `text` is what the user last copied. */
export interface Selection { text: string; status: "ok" | "empty" | "permission" | "copied"; auto?: boolean }
export const translationPlatform = {
  async setShortcut(shortcut: string | null): Promise<void> { if (isTauri()) await invoke("set_translation_shortcut", { shortcut }); },
  async open(): Promise<void> { if (isTauri()) await invoke("open_translation"); },
  async openAccessibilitySettings(): Promise<void> { if (isTauri()) await invoke("open_accessibility_settings"); },
  async selectionAvailable(): Promise<boolean> { return isTauri() ? invoke("selection_status") : false; },
  async takeSelection(): Promise<Selection | null> { return isTauri() ? invoke("take_translation_selection") : null; },
  async onOpen(handler: () => void): Promise<() => void> { return isTauri() ? listen("pet://translation-open", handler) : () => {}; },
  async onHide(handler: () => void): Promise<() => void> { return isTauri() ? listen("pet://translation-hide", handler) : () => {}; },
};
