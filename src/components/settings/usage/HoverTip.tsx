import { useState, type KeyboardEvent } from "react";

/** Where a slot sits across its chart, as a fraction; tips near an edge are kept inside the chart. */
const EDGE = 0.15;

/** Which slot the pointer or the arrow keys are on; null when none. */
export function useSlotPointer(count: number) {
  const [index, setIndex] = useState<number | null>(null);
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setIndex((now) => Math.min(count - 1, Math.max(0, (now ?? (step > 0 ? -1 : count)) + step)));
  };
  return {
    index,
    enter: (slot: number) => setIndex(slot),
    plotProps: { tabIndex: 0, onKeyDown, onPointerLeave: () => setIndex(null), onBlur: () => setIndex(null) },
  };
}

/** The numbers behind one mark, just above it: `at` is the mark's middle across the chart and `top` its top edge down it, both 0 to 1. */
export function HoverTip({ at, top, title, value }: { at: number; top: number; title: string; value: string }) {
  const side = at < EDGE ? "is-start" : at > 1 - EDGE ? "is-end" : "";
  return <div className={`usage-tip ${side}`} style={{ left: `${at * 100}%`, top: `${top * 100}%` }} role="status">
    <span>{title}</span><strong>{value}</strong>
  </div>;
}
