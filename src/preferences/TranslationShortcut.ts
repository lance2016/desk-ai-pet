import { recordShortcut } from "./QuickChatPreferences";
const KEY = "ai-pet:translation-shortcut:v1";
export const DEFAULT_TRANSLATION_SHORTCUT = "Control+Alt+Super+KeyT";
export function loadTranslationShortcut(storage: Storage = window.localStorage): string | null {
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return DEFAULT_TRANSLATION_SHORTCUT;
    const value: unknown = JSON.parse(raw);
    if (value === null) return null;
    if (typeof value !== "string") throw new Error("Invalid shortcut");
    const parts = value.split("+");
    const code = parts.pop() ?? "";
    const parsed = recordShortcut({ code, ctrlKey: parts.includes("Control"), altKey: parts.includes("Alt"), shiftKey: parts.includes("Shift"), metaKey: parts.includes("Super") });
    if (!parsed.ok || parsed.shortcut !== value) throw new Error("Invalid shortcut");
    return value;
  } catch (error) { console.warn("Ignoring invalid translation shortcut", error); return DEFAULT_TRANSLATION_SHORTCUT; }
}
export function saveTranslationShortcut(value: string | null, storage: Storage = window.localStorage): void { storage.setItem(KEY, JSON.stringify(value)); }
