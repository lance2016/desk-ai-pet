import type { KeyboardEvent } from "react";

/**
 * Whether a key press still belongs to an input method, e.g. the Enter that
 * puts pinyin on screen as English. WebKit fires `compositionend` before that
 * `keydown`, so `isComposing` is already false; `keyCode` 229 still tells.
 */
export function isComposing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/**
 * Whether an Esc that reached the window should put a popover away. Fields and editors
 * that handle Esc themselves call `preventDefault`; a focused field with text in it keeps
 * the panel, so nothing typed is hidden by accident.
 */
export function escapeHidesPanel(event: globalThis.KeyboardEvent): boolean {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229) return false;
  const focused = document.activeElement;
  return !((focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) && focused.value.trim());
}
