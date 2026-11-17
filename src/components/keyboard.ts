import type { KeyboardEvent } from "react";

/**
 * Whether a key press still belongs to an input method, e.g. the Enter that
 * puts pinyin on screen as English. WebKit fires `compositionend` before that
 * `keydown`, so `isComposing` is already false; `keyCode` 229 still tells.
 */
export function isComposing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}
