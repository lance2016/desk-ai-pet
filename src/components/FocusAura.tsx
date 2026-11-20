import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { PetRuntime } from "../core/PetRuntime";
import { focusProgress } from "../behavior/FocusTimer";
import { FOCUS_ACTION } from "../behavior/BehaviorEngine";
import { BREATHE_SECONDS } from "../renderer/motions";

const POOL = "/focus/platform.png";
/** The progress arc follows the countdown, which changes once a second. */
const TICK_MS = 1000;
/** Keep the pool in place briefly while it fades. */
export const FOCUS_EXIT_MS = 200;
/**
 * The front half of the pool's outer ripple, in the picture's own pixels (640 × 204),
 * drawn from the right end to the left: time spent eats it from the left.
 */
const ARC_PATH = "M 572 100 A 252 60 0 0 1 68 100";

/**
 * The pool of light under the seated pet during a focus round. Its front rim is
 * the progress arc; it runs in front of the pet's feet, so no part of it is ever hidden.
 * The time and the stop control are the focus pill in the status row.
 */
export function FocusAura({ runtime, visible }: { runtime: PetRuntime; visible: boolean }) {
  const focus = useSyncExternalStore(runtime.focus.subscribe, runtime.focus.get);
  const [now, setNow] = useState(Date.now);
  const focusing = focus.phase === "focusing";
  // The pet's breath starts over each time its focus pose starts; the pool starts over with it.
  const [breath, setBreath] = useState(0);
  useEffect(() => runtime.bus.on("pet.action.started", ({ actionId }) => {
    if (actionId === FOCUS_ACTION) setBreath((count) => count + 1);
  }), [runtime]);
  useEffect(() => {
    if (!focusing) return;
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(refresh, TICK_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [focusing]);
  if (!visible) return null;

  const remaining = focusing ? 1 - (focusProgress(focus, now) ?? 0) : 0;
  const style = { "--focus-exit-duration": `${FOCUS_EXIT_MS}ms`, "--breath": `${BREATHE_SECONDS}s` } as CSSProperties;
  return (
    <div className={`focus-aura${focusing ? "" : " focus-aura--exiting"}`} style={style} aria-hidden="true">
      <div className="focus-aura__pool">
        <img key={breath} className="focus-aura__ripple" src={POOL} alt="" draggable={false} />
        <svg className="focus-aura__progress" viewBox="0 0 640 204">
          <path className="focus-aura__track" d={ARC_PATH} />
          <path className="focus-aura__arc" d={ARC_PATH} pathLength={1} strokeDasharray={`${remaining} 1`} />
        </svg>
      </div>
    </div>
  );
}
