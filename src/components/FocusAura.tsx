import { useEffect, useState, useSyncExternalStore, type CSSProperties, type Ref } from "react";
import type { PetRuntime } from "../core/PetRuntime";
import { focusBadge, focusProgress } from "../behavior/FocusTimer";

const LOTUS = "/focus/lotus.png";
const PLATFORM = "/focus/platform.png";
/** The progress arc follows the countdown, which changes once a second. */
const TICK_MS = 1000;
/** Keep the stage and its controls in place briefly while the focus glow fades. */
export const FOCUS_EXIT_MS = 200;
const ARC_RADIUS = 48;
const ARC_LENGTH = 2 * Math.PI * ARC_RADIUS;

/**
 * The remaining time follows a fine arc behind the pet. The lotus labels the stop control.
 */
export function FocusAura({ runtime, visible, ref }: { runtime: PetRuntime; visible: boolean; ref?: Ref<HTMLButtonElement> }) {
  const focus = useSyncExternalStore(runtime.focus.subscribe, runtime.focus.get);
  const [now, setNow] = useState(Date.now);
  const focusing = focus.phase === "focusing";
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
  const countdown = focusing ? focusBadge(focus, now)?.split(" ")[1] : undefined;
  const style = {
    "--focus-exit-duration": `${FOCUS_EXIT_MS}ms`,
    "--focus-ripple-opacity": String(.52 + .28 * remaining),
  } as CSSProperties;
  return (
    <div className={`focus-aura${focusing ? "" : " focus-aura--exiting"}`} style={style}>
      <div className="focus-aura__halo">
        <svg className="focus-aura__ring" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <circle className="focus-aura__track" cx="50" cy="50" r={ARC_RADIUS} />
          <circle className="focus-aura__arc" cx="50" cy="50" r={ARC_RADIUS} strokeDasharray={`${remaining * ARC_LENGTH} ${ARC_LENGTH}`} transform="rotate(-90 50 50)" />
          <circle className="focus-aura__endpoint" cx="50" cy={50 - ARC_RADIUS} r="1" style={{ transform: `rotate(${remaining * 360}deg)` }} />
        </svg>
        <button
          ref={ref}
          type="button"
          className="focus-aura__stop"
          aria-label="结束专注"
          aria-description={countdown && `剩余 ${countdown}`}
          disabled={!focusing}
          onClick={() => runtime.bus.emit("pet.focus_stopped", {})}
        >
          <img src={LOTUS} alt="" draggable={false} />
          <span className="focus-aura__hint" aria-hidden="true">结束专注</span>
        </button>
        <span className="focus-aura__countdown" aria-hidden="true">{countdown}</span>
      </div>
      <img className="focus-aura__ripple" src={PLATFORM} alt="" draggable={false} />
    </div>
  );
}
