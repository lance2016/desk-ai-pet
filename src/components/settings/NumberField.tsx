import { useEffect, useState } from "react";

interface Props {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
}

/**
 * A number input that can be cleared while typing: the text is kept as typed,
 * and only a real number is passed on. Leaving the field shows the value again.
 */
export function NumberField({ value, onChange, min, max, step }: Props) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return <input type="number" min={min} max={max} step={step} value={text}
    onChange={(event) => {
      const next = event.currentTarget.value;
      setText(next);
      if (next.trim() !== "" && Number.isFinite(Number(next))) onChange(Number(next));
    }}
    onBlur={() => setText(String(value))} />;
}
