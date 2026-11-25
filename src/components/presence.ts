import { useEffect, useState } from "react";

/** How long the pet's controls take to fade out: `--ui-duration` in tokens.css. */
export const FADE_OUT_MS = 180;

/** True while `active` is true, and for `delayMs` after it turns false. */
export function useLingering(active: boolean, delayMs: number): boolean {
  const [lingering, setLingering] = useState(active);
  useEffect(() => {
    if (active) {
      setLingering(true);
      return;
    }
    const timer = setTimeout(() => setLingering(false), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return active || lingering;
}

/** `value` while `live`; afterwards the last value it had then, so an element fading out keeps what it showed. */
export function useHeld<T>(value: T, live: boolean): T {
  const [held, setHeld] = useState(value);
  if (live && held !== value) setHeld(value);
  return live ? value : held;
}
