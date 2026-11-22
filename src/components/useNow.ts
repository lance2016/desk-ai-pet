import { useEffect, useState } from "react";

/** The time, brought up to date every `everyMs` while `ticking`: for labels that say how long ago or for how long. */
export function useNow(ticking: boolean, everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [ticking, everyMs]);
  return now;
}
