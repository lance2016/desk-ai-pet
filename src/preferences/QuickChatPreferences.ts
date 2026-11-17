import { z } from "zod";

/** Global, not per character: the shortcut belongs to the app. */
const KEY = "ai-pet:quick-chat-shortcut:v1";

/** Modifiers in the order an accelerator lists them, with their Mac symbols. */
const MODIFIERS = [
  { name: "Control", symbol: "⌃", flag: "ctrlKey" },
  { name: "Alt", symbol: "⌥", flag: "altKey" },
  { name: "Shift", symbol: "⇧", flag: "shiftKey" },
  { name: "Super", symbol: "⌘", flag: "metaKey" },
] as const;

/**
 * Keys a shortcut may end with, as `KeyboardEvent.code` names, which the
 * native side parses as they are.
 */
const KEY_CODE = /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2])|Space|Enter|Tab|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Arrow(Up|Down|Left|Right))$/;
const ARROWS: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };

/**
 * A shortcut is `Modifier+...+Code` and must hold Control or Command: since
 * macOS 15 the system no longer delivers global shortcuts whose only modifiers
 * are Option or Option-Shift. The same rule is checked in `src-tauri/src/quick_chat.rs`.
 */
const ACCELERATOR = /^(Control\+)?(Alt\+)?(Shift\+)?(Super\+)?[A-Za-z0-9]+$/;
const schema = z.string()
  .regex(ACCELERATOR)
  .refine((value) => KEY_CODE.test(value.split("+").pop() ?? ""))
  .refine((value) => value.startsWith("Control+") || value.includes("Super+"))
  .nullable();

/**
 * Combinations macOS or nearly every app already uses (copy, paste, quit,
 * Spotlight, switching apps, screenshots…). Taking one would break it
 * everywhere. Must match `RESERVED_SHORTCUTS` in `src-tauri/src/quick_chat.rs`.
 */
export const RESERVED_SHORTCUTS: readonly string[] = [
  "Super+KeyA",
  "Super+KeyC",
  "Super+KeyV",
  "Super+KeyX",
  "Super+KeyZ",
  "Shift+Super+KeyZ",
  "Super+KeyQ",
  "Super+KeyW",
  "Super+KeyH",
  "Super+KeyM",
  "Super+KeyS",
  "Super+KeyF",
  "Super+KeyN",
  "Super+KeyO",
  "Super+KeyP",
  "Super+KeyT",
  "Super+Space",
  "Control+Space",
  "Control+Super+Space",
  "Super+Tab",
  "Shift+Super+Tab",
  "Super+Comma",
  "Super+Backquote",
  "Control+Super+KeyF",
  "Control+Super+KeyQ",
  "Shift+Super+Digit3",
  "Shift+Super+Digit4",
  "Shift+Super+Digit5",
];

export type QuickChatShortcut = string;
export const DEFAULT_QUICK_CHAT_SHORTCUT: QuickChatShortcut = "Shift+Super+Space";

/** The saved shortcut, `null` when it is turned off. */
export function loadQuickChatShortcut(): QuickChatShortcut | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === null ? DEFAULT_QUICK_CHAT_SHORTCUT : schema.parse(JSON.parse(raw));
  } catch (error) {
    console.warn("Ignoring an invalid quick chat shortcut", error);
    return DEFAULT_QUICK_CHAT_SHORTCUT;
  }
}

export function saveQuickChatShortcut(value: QuickChatShortcut | null): void {
  window.localStorage.setItem(KEY, JSON.stringify(schema.parse(value)));
}

type KeyPress = Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;
export type RecordResult =
  | { ok: true; shortcut: QuickChatShortcut }
  | { ok: false; reason: "waiting" | "needs-modifier" | "unsupported-key" | "reserved" };

/** Reads a key press in the recorder. Modifier keys on their own mean the user is still pressing. */
export function recordShortcut(press: KeyPress): RecordResult {
  if (/^(Control|Alt|Shift|Meta)(Left|Right)$/.test(press.code)) return { ok: false, reason: "waiting" };
  if (!press.ctrlKey && !press.metaKey) return { ok: false, reason: "needs-modifier" };
  if (!KEY_CODE.test(press.code)) return { ok: false, reason: "unsupported-key" };
  const modifiers = MODIFIERS.filter((modifier) => press[modifier.flag]).map((modifier) => modifier.name);
  const shortcut = [...modifiers, press.code].join("+");
  if (RESERVED_SHORTCUTS.includes(shortcut)) return { ok: false, reason: "reserved" };
  return { ok: true, shortcut };
}

/** "⇧⌘ Space", "⌃⌥ K". */
export function quickChatShortcutLabel(value: QuickChatShortcut): string {
  const parts = value.split("+");
  const code = parts[parts.length - 1] ?? "";
  const symbols = MODIFIERS.filter((modifier) => parts.includes(modifier.name)).map((modifier) => modifier.symbol).join("");
  const key = ARROWS[code] ?? code.replace(/^(Key|Digit)/, "");
  return `${symbols} ${key}`;
}
