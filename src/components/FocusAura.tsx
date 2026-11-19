import { useEffect, useState, useSyncExternalStore } from "react";
import type { PetRuntime } from "../core/PetRuntime";
import { focusProgress } from "../behavior/FocusTimer";

const RING = "/focus/ring.png";
const PLATFORM = "/focus/platform.png";
/** The progress arc follows the countdown, which changes once a second. */
const TICK_MS = 1000;
/** Radius of the circle drawn in ring.png, in the arc's 100-unit view box. */
const ARC_RADIUS = 49.4;

/**
 * The glow around the pet while a focus round runs: a glass ring whose bright arc
 * grows as the round goes by, and ripples under the pet. Only decoration: it takes no clicks.
 */
export function FocusAura({ runtime }: { runtime: PetRuntime }) {
  const focus = useSyncExternalStore(runtime.focus.subscribe, runtime.focus.get);
  const [now, setNow] = useState(Date.now);
  const focusing = focus.phase === "focusing";
  useEffect(() => {
    if (!focusing) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [focusing]);
  if (!focusing) return null;

  const progress = focusProgress(focus, now) ?? 0;
  const angle = progress * 2 * Math.PI;
  const dot = { x: 50 + ARC_RADIUS * Math.sin(angle), y: 50 - ARC_RADIUS * Math.cos(angle) };
  return (
    <div className="focus-aura" aria-hidden="true">
      <img className="focus-aura__platform" src={PLATFORM} alt="" />
      <div className="focus-aura__ring">
        <img src={RING} alt="" />
        <svg viewBox="0 0 100 100">
          <defs>
            <linearGradient id="focus-arc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="1" stopColor="#a996ee" />
            </linearGradient>
          </defs>
          {/* Starts at the top and runs clockwise. */}
          <circle className="focus-aura__arc" cx="50" cy="50" r={ARC_RADIUS} pathLength={1} strokeDasharray={`${progress} 1`} transform="rotate(-90 50 50)" />
          <circle className="focus-aura__dot" cx={dot.x} cy={dot.y} r="1.4" />
        </svg>
      </div>
    </div>
  );
}
