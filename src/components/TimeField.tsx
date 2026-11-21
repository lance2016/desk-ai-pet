import { useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import { parseClock, stepClock } from "./clockText";
import { isComposing } from "./keyboard";

interface TimeFieldProps {
  /** "HH:MM". */
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

const SEPARATOR = /[:：.]/;
/** Where the hour and the minute sit in "HH:MM", to keep the caret on the part the arrow keys move. */
const PART_RANGE = { hour: [0, 2], minute: [3, 5] } as const;

/**
 * A time of day that takes typing ("2230", "22:30", "9:30") and the arrow keys.
 * Replaces `<input type="time">`: WebKit's takes typing only segment by segment, which reads as "can't type".
 * The typed text is checked on Return or when the field loses focus; text that is not a time is dropped.
 */
export function TimeField({ value, onChange, label, disabled, className }: TimeFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  /** Set by the click that focuses the field, so its mouseup does not undo the select-all. */
  const justFocused = useRef(false);

  const commit = () => {
    if (draft === null) return;
    const next = parseClock(draft);
    if (next && next !== value) onChange(next);
    setDraft(null);
  };
  const onFocus = (event: FocusEvent<HTMLInputElement>) => { event.currentTarget.select(); justFocused.current = true; };
  const onMouseUp = (event: MouseEvent<HTMLInputElement>) => { if (justFocused.current) event.preventDefault(); justFocused.current = false; };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(event)) return;
    if (event.key === "Enter") { event.preventDefault(); commit(); return; }
    if (event.key === "Escape" && draft !== null) { event.preventDefault(); event.stopPropagation(); setDraft(null); return; }
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const input = event.currentTarget;
    const text = draft ?? value;
    const separator = text.search(SEPARATOR);
    const part = separator >= 0 && (input.selectionStart ?? 0) <= separator ? "hour" : "minute";
    const next = stepClock(parseClock(text) ?? value, part, event.key === "ArrowUp" ? 1 : -1);
    setDraft(null);
    if (next !== value) onChange(next);
    const [start, end] = PART_RANGE[part];
    requestAnimationFrame(() => input.setSelectionRange(start, end));
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      maxLength={5}
      className={className ? `time-field ${className}` : "time-field"}
      aria-label={label}
      disabled={disabled}
      value={draft ?? value}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onFocus={onFocus}
      onMouseUp={onMouseUp}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
