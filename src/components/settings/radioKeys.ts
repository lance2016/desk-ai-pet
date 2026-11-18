import type { KeyboardEvent } from "react";

/**
 * Arrow keys move the choice in a `role="radiogroup"` of buttons, as they do
 * for radio buttons: put it on the group's `onKeyDown`.
 */
export function moveRadioChoice(event: KeyboardEvent<HTMLElement>): void {
  const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
  if (step === 0) return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)')];
  const index = radios.findIndex((radio) => radio === document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const next = radios[(index + step + radios.length) % radios.length];
  next.focus();
  next.click();
}
