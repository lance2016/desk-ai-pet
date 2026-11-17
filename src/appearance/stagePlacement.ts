import { ART_CANVAS, ART_FIGURE_HEIGHT, ART_GROUND_GAP } from "../assets/ArtPrompt";
import type { PictureCrop } from "./pictureCrop";

/**
 * Placing a picked picture on the pet's stage: the fixed box the pet is drawn
 * in (the pack's `canvas`), whose bottom edge is the ground. The renderer draws
 * every frame at its own pixel size, bottom-centred on the stage (left-aligned
 * for `align: "left"`), so a picture keeps the size and spot it is given here.
 */

export interface Size { width: number; height: number }
export interface Rect extends Size { x: number; y: number }
export type StageAlign = "left" | "center";

/** Where one frame of the picture lands on the stage, in stage pixels. */
export interface Placement { left: number; top: number; scale: number }

/** How far from square a picture may be and still count as drawn to the art prompt's canvas. */
const SQUARE_TOLERANCE = 0.02;

/** The cropper's terms (the stage is its frame) to stage pixels. */
export function placementFromCrop(crop: PictureCrop, frame: Size, stage: Size): Placement {
  const width = stage.width / crop.zoom;
  const scale = width / frame.width;
  return { scale, left: stage.width / 2 - crop.x * width, top: stage.height / 2 - crop.y * frame.height * scale };
}

export function cropFromPlacement(placement: Placement, frame: Size, stage: Size): PictureCrop {
  const width = frame.width * placement.scale;
  const height = frame.height * placement.scale;
  return { x: (stage.width / 2 - placement.left) / width, y: (stage.height / 2 - placement.top) / height, zoom: stage.width / width, ratio: frame.height / frame.width };
}

/** A picture already at stage scale (the pack's own, or one placed before), where the pet shows it. */
export function restingPlacement(frame: Size, stage: Size, align: StageAlign): Placement {
  return { scale: 1, left: align === "left" ? 0 : (stage.width - frame.width) / 2, top: stage.height - frame.height };
}

/**
 * A picture drawn to the art prompt's canvas: scaled so its standing figure is
 * `figureHeight` stage pixels tall, with its ground on the stage's. Whatever the
 * pose, the character keeps that scale. Null for a picture of another shape.
 * A left-aligned picture puts what it shows (from `visibleLeft`) against the stage's left edge.
 */
export function promptPlacement(frame: Size, stage: Size, align: StageAlign, figureHeight: number, visibleLeft = 0): Placement | null {
  const square = ART_CANVAS.width / ART_CANVAS.height;
  if (Math.abs(frame.width / frame.height - square) > SQUARE_TOLERANCE) return null;
  const scale = figureHeight / (frame.height * (ART_FIGURE_HEIGHT / ART_CANVAS.height));
  const ground = frame.height * (ART_GROUND_GAP / ART_CANVAS.height) * scale;
  return { scale, left: align === "left" ? -visibleLeft * scale : (stage.width - frame.width * scale) / 2, top: stage.height + ground - frame.height * scale };
}

/** Any other picture: what it shows fills the action's usual frame and stands on the ground. */
export function fittedPlacement(visible: Rect, target: Size, stage: Size, align: StageAlign): Placement {
  const scale = Math.min(target.width / visible.width, target.height / visible.height);
  const left = align === "left" ? -visible.x * scale : stage.width / 2 - (visible.x + visible.width / 2) * scale;
  return { scale, left, top: stage.height - (visible.y + visible.height) * scale };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a || !b) return a ?? b;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/**
 * The part of the stage a placed picture is saved as. It reaches down to the
 * ground and is as far either side of the centre (or from the left edge) as
 * the picture goes, so drawn back where the renderer anchors it, the picture
 * sits exactly where it was placed.
 */
export function keptRegion(visible: Rect, stage: Size, align: StageAlign): Rect {
  const top = Math.max(0, Math.floor(visible.y));
  const height = stage.height - top;
  if (align === "left") return { x: 0, y: top, width: Math.max(1, Math.min(stage.width, Math.ceil(visible.x + visible.width))), height };
  const center = stage.width / 2;
  const half = Math.max(1, Math.min(center, Math.ceil(Math.max(center - visible.x, visible.x + visible.width - center))));
  return { x: center - half, y: top, width: half * 2, height };
}
