import type { MotionPreset } from "../types";

/** Offsets in stage pixels, scale as a multiplier, rotation in radians. */
export interface MotionTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

/**
 * A motion maps time to a transform. `seconds` is the time since the action
 * started; `progress` runs 0..1 over the action's duration (0 when open-ended).
 */
type Motion = (seconds: number, progress: number) => Partial<MotionTransform>;

const REST: MotionTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
const TAU = Math.PI * 2;

/** Rises from 0 to 1 and returns to 0 across the action. */
const arc = (progress: number) => Math.sin(Math.PI * progress);

const MOTIONS: Record<MotionPreset, Motion> = {
  none: () => ({}),
  // Slow chest rise: taller and slightly narrower, then back.
  breathe: (seconds) => {
    const wave = Math.sin((TAU * seconds) / 3.2);
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
  // Leans to one side, holds, and comes back.
  tilt: (_seconds, progress) => ({ rotation: 0.06 * arc(progress) }),
};

export function sampleMotion(preset: MotionPreset, seconds: number, progress: number): MotionTransform {
  return { ...REST, ...MOTIONS[preset](seconds, progress) };
}

/** Applies user-selected speed and intensity to a built-in motion. */
export function sampleAdjustedMotion(preset: MotionPreset, seconds: number, progress: number, speed: number, strength: number): MotionTransform {
  const value = sampleMotion(preset, seconds * speed, Math.min(1, progress * speed));
  return { x: value.x * strength, y: value.y * strength, rotation: value.rotation * strength,
    scaleX: 1 + (value.scaleX - 1) * strength, scaleY: 1 + (value.scaleY - 1) * strength };
}
