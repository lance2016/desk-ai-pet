import { z } from "zod";
import { ACTION_SCENES, ACTION_TIERS, CONTROL_ICON_PRESETS, MIMO_VOICES, MOTION_PRESETS, PERSONA_LIMITS } from "../types";

/** Asset files must stay inside the pack: relative, no scheme, no parent segments. */
const assetPathSchema = z
  .string()
  .min(1)
  .refine(
    (path) => !path.startsWith("/") && !path.includes("\\") && !path.includes(":") && !path.split("/").includes(".."),
    "must be a relative path inside the asset pack",
  );

/** A rectangle in fractions (0..1) of the animation frame. */
const areaSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

const layerSchema = z.object({
  /** Additional transparent image drawn over the action's main image. */
  file: assetPathSchema,
  frames: z.number().int().positive().default(1),
  fps: z.number().positive().default(12),
  /** Offset from the main sprite's bottom-center anchor, in source pixels. */
  x: z.number().default(0),
  y: z.number().default(0),
  scaleX: z.number().positive().default(1),
  scaleY: z.number().positive().default(1),
  rotation: z.number().default(0),
  zIndex: z.number().int().default(1),
  motion: z.enum(MOTION_PRESETS).default("none"),
  /** Optional one-based inclusive frame range of the main animation. */
  startFrame: z.number().int().positive().optional(),
  endFrame: z.number().int().positive().optional(),
});

/**
 * One entry describes both the animation (how it looks) and the action (how it
 * is scheduled). Only `id` and `file` are required.
 */
export const animationSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  description: z.string().optional(),
  /** How to draw this action, quoted in the prompt users take to an image model. */
  pose: z.string().min(1).optional(),
  /** Image with all frames side by side in one row. */
  file: assetPathSchema,
  frames: z.number().int().positive().default(1),
  fps: z.number().positive().default(12),
  loop: z.boolean().default(false),
  motion: z.enum(MOTION_PRESETS).default("none"),
  /** "left" puts the drawing against the stage's left edge, for art cut off by a wall. */
  align: z.enum(["center", "left"]).default("center"),
  /** Optional transparent overlays for composite actions and accessories. */
  layers: z.array(layerSchema).default([]),
  category: z.string().min(1).default("reaction"),
  priority: z.number().default(10),
  interruptible: z.boolean().default(true),
  duration: z.number().positive().optional(),
  cooldown: z.number().nonnegative().optional(),
  /** The action whose picture this one wears while it has none of its own; the chain ends at idle. */
  fallback: z.string().min(1).optional(),
  /** Set for standard actions: how early a character with few pictures should draw this one. */
  tier: z.enum(ACTION_TIERS).optional(),
  /** Set for standard actions: the situation the pet does this in, which groups the action library. */
  scene: z.enum(ACTION_SCENES).optional(),
  /** A pose no other picture can stand in for, such as hiding behind an edge: without its own picture the action is off. */
  requiresArt: z.boolean().optional(),
  /** Set when the pack has no picture for this standard action: the action whose picture `file` is. */
  borrowedFrom: z.string().min(1).optional(),
});

/** A standard action as the catalog lists it: everything but the picture, which each character brings. */
export const standardActionSchema = animationSchema
  .omit({ file: true, frames: true, fps: true, layers: true, borrowedFrom: true })
  .required({ tier: true, scene: true, label: true, description: true, pose: true });

const controlSchema = z.object({
  id: z.enum(["focus", "feed", "wooden_fish", "sleep_toggle"]),
  label: z.string().min(1),
  icon: z.union([
    z.enum(CONTROL_ICON_PRESETS),
    z.object({ file: assetPathSchema }),
  ]),
  command: z.enum(["focus_toggle", "feed", "wooden_fish", "sleep_toggle"]),
});

/** Who the character is. Users can override these defaults per character. */
const personaSchema = z.object({
  name: z.string().trim().min(1).max(PERSONA_LIMITS.name),
  personality: z.string().trim().max(PERSONA_LIMITS.personality).default(""),
  voice: z.enum(MIMO_VOICES).optional(),
  voiceStyle: z.string().trim().max(PERSONA_LIMITS.voiceStyle).optional(),
});

const manifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  /** Stage size in source pixels. Every animation is drawn bottom-centered in it. */
  canvas: z.object({ width: z.number().positive(), height: z.number().positive() }),
  /** Display size of one source pixel at the default pet size. */
  scale: z.number().positive().default(1),
  /** Part of the frame that counts as the head when clicked. */
  headArea: areaSchema.default({ x: 0, y: 0, width: 1, height: 0.5 }),
  animations: z.array(animationSchema).min(1),
  /** Visible quick actions. Labels and icons are supplied by the asset pack. */
  controls: z.array(controlSchema).default([]),
  persona: personaSchema.optional(),
});

export type AnimationEntry = z.infer<typeof animationSchema>;
export type AnimationLayer = z.infer<typeof layerSchema>;
export type PetManifest = z.infer<typeof manifestSchema>;
export type PetControl = z.infer<typeof controlSchema>;
export type PetPersona = z.infer<typeof personaSchema>;

/** Validates untrusted manifest data. Throws with a readable message when invalid. */
export function parseManifest(raw: unknown): PetManifest {
  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid pet manifest: ${z.prettifyError(result.error)}`);
  }
  const ids = result.data.animations.map((animation) => animation.id);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) {
    throw new Error(`Invalid pet manifest: duplicate animation id "${duplicate}"`);
  }
  const controlIds = result.data.controls.map((control) => control.id);
  const duplicateControl = controlIds.find((id, index) => controlIds.indexOf(id) !== index);
  if (duplicateControl) {
    throw new Error(`Invalid pet manifest: duplicate control id "${duplicateControl}"`);
  }
  return result.data;
}
