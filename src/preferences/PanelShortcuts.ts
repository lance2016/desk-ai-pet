import { recordShortcut } from "./QuickChatPreferences";

/** The panels a global shortcut can open beside the pet. Must match `set_panel_shortcut` in `src-tauri/src/quick_chat.rs`. */
export type ShortcutPanel = "today" | "notes";
export const SHORTCUT_PANELS: readonly ShortcutPanel[] = ["today", "notes"];
const KEYS: Record<ShortcutPanel, string> = { today: "ai-pet:today-shortcut:v1", notes: "ai-pet:notes-shortcut:v1" };

/** The shortcut that opens `panel`, or null. None is set until the user records one: any default could take keys another app uses. */
export function loadPanelShortcut(panel: ShortcutPanel, storage: Storage = window.localStorage): string | null {
  try {
    const raw = storage.getItem(KEYS[panel]);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (value === null) return null;
    if (typeof value !== "string") throw new Error("Invalid shortcut");
    const parts = value.split("+");
    const code = parts.pop() ?? "";
    const parsed = recordShortcut({ code, ctrlKey: parts.includes("Control"), altKey: parts.includes("Alt"), shiftKey: parts.includes("Shift"), metaKey: parts.includes("Super") });
    if (!parsed.ok || parsed.shortcut !== value) throw new Error("Invalid shortcut");
    return value;
  } catch (error) { console.warn(`Ignoring an invalid ${panel} shortcut`, error); return null; }
}

export function savePanelShortcut(panel: ShortcutPanel, value: string | null, storage: Storage = window.localStorage): void {
  if (value === null) storage.removeItem(KEYS[panel]);
  else storage.setItem(KEYS[panel], JSON.stringify(value));
}
