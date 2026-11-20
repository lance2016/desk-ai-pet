import type { MotionPreset } from "../types";

/** Offsets in stage pixels, scale as a multiplier, rotation in radians. */
export interface MotionTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
}

/**
 * A motion maps time to a transform. `seconds` is the time since the action
 * started; `progress` runs 0..1 over the action's duration (0 when open-ended).
 */
type Motion = (seconds: number, progress: number) => Partial<MotionTransform>;

const REST: MotionTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, alpha: 1 };
const TAU = Math.PI * 2;

/** One breath of the "breathe" motion, in seconds. The focus pool (`FocusAura`) breathes along with it. */
export const BREATHE_SECONDS = 3.2;

/** Rises from 0 to 1 and returns to 0 across the action. */
const arc = (progress: number) => Math.sin(Math.PI * progress);

const MOTIONS: Record<MotionPreset, Motion> = {
  none: () => ({}),
  // Slow chest rise: taller and slightly narrower, then back.
  breathe: (seconds) => {
    const wave = Math.sin((TAU * seconds) / BREATHE_SECONDS);
    return { scaleY: 1 + 0.012 * wave, scaleX: 1 - 0.006 * wave };
  },
  // Repeated hops that squash a little on landing.
  bounce: (seconds) => {
    const hop = Math.abs(Math.sin(TAU * seconds * 1.1));
    return { y: -18 * hop, scaleY: 1 + 0.03 * hop - 0.015, scaleX: 1 - 0.02 * hop + 0.01 };
  },
  // Leans left and right around the feet.
  sway: (seconds) => ({ rotation: 0.045 * Math.sin((TAU * seconds) / 1.6) }),
  // One quick dip, used as a stand-in for a blink.
  squash: (_seconds, progress) => ({ scaleY: 1 - 0.035 * arc(progress), scaleX: 1 + 0.015 * arc(progress) }),
  // Fast small shake that fades out.
  wiggle: (seconds, progress) => {
    const fade = 1 - progress;
    return { x: 5 * fade * Math.sin(TAU * seconds * 6), rotation: 0.02 * fade * Math.sin(TAU * seconds * 6) };
  },
  // Stretches up, overshoots, then settles.
  pop: (_seconds, progress) => {
    const settle = Math.sin(TAU * 1.5 * progress) * (1 - progress);
    return { scaleY: 1 + 0.08 * settle, scaleX: 1 - 0.05 * settle };
  },
  // A short rise and fade for an impact label.
  float: (_seconds, progress) => ({ y: -45 * progress, alpha: 1 - progress }),
  // Leans to one side, holds, and comes back.
  tilt: (_seconds, progress) => ({ rotation: 0.06 * arc(progress) }),
  // Small quick nods, as when talking.
  nod: (seconds) => {
    const beat = Math.sin(TAU * seconds * 1.5);
    return { y: -3 * Math.max(0, beat), rotation: 0.014 * beat };
  },
};

/**
 * Motions that move the whole pet around the stage. With the system's Reduce Motion
 * on they are left out; the picture still shows the action. `float` stays: it only
 * lifts a small label.
 */
const TRAVELLING: ReadonlySet<MotionPreset> = new Set(["bounce", "sway", "wiggle"]);

export function calmMotion(preset: MotionPreset, reduceMotion: boolean): MotionPreset {
  return reduceMotion && TRAVELLING.has(preset) ? "none" : preset;
}

export function sampleMotion(preset: MotionPreset, seconds: number, progress: number): MotionTransform {
  return { ...REST, ...MOTIONS[preset](seconds, progress) };
}

/** How long a new action takes to pick the pet up from where the last one left it. */
export const SETTLE_MS = 200;

/**
 * Eases the pet from where the last action left it into the new action's motion, so an
 * action that ends in the air or leaning does not jump back to rest. `elapsedMs` is the time
 * since the new action started. Opacity is not carried: a label that faded out must not hide what comes next.
 */
export function settleMotion(from: MotionTransform, to: MotionTransform, elapsedMs: number): MotionTransform {
  if (elapsedMs >= SETTLE_MS) return to;
  // Eases in and out: at 30 frames a second a curve that starts fast would cover half the way in its first frame.
  const done = Math.max(0, elapsedMs) / SETTLE_MS;
  const left = 1 - done * done * (3 - 2 * done);
  const mix = (old: number, next: number) => next + (old - next) * left;
  return {
    x: mix(from.x, to.x),
    y: mix(from.y, to.y),
    scaleX: mix(from.scaleX, to.scaleX),
    scaleY: mix(from.scaleY, to.scaleY),
    rotation: mix(from.rotation, to.rotation),
    alpha: to.alpha,
  };
}

/** Applies user-selected speed and intensity to a built-in motion. */
export function sampleAdjustedMotion(preset: MotionPreset, seconds: number, progress: number, speed: number, strength: number): MotionTransform {
  const value = sampleMotion(preset, seconds * speed, Math.min(1, progress * speed));
  return { x: value.x * strength, y: value.y * strength, rotation: value.rotation * strength,
    scaleX: 1 + (value.scaleX - 1) * strength, scaleY: 1 + (value.scaleY - 1) * strength, alpha: value.alpha };
}
