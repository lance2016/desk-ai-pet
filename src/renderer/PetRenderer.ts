import type { ActionAppearance } from "../appearance/AppearanceStore";
import type { AssetPack } from "../assets/AssetLoader";
import type { AnimationEntry } from "../assets/Manifest";
import type { HitRegion } from "../types";

/** Which cells of the view are drawn, as rows of square cells from the top left. */
export interface OpaqueMask {
  columns: number;
  rows: number;
  cells: boolean[];
}

/** Rendering boundary. Pet logic talks to this, never to a graphics library. */
export interface PetRenderer {
  /** Loads the pack's images and returns the ids of the animations that are usable. */
  loadAssetPack(pack: AssetPack): Promise<ReadonlySet<string>>;
  setAppearance(animationId: string, appearance: ActionAppearance | null): Promise<void>;
  /** Loads one more animation from the loaded pack, such as an action the user made. Resolves to whether it is usable. */
  addAnimation(entry: AnimationEntry): Promise<boolean>;
  /** Forgets an animation. Callers stop it first if it is playing. */
  removeAnimation(animationId: string): void;
  playAction(animationId: string): void;
  stopAction(): void;
  /** Flips the drawing horizontally, so left-aligned art sits on the right edge. */
  setMirrored(mirrored: boolean): void;
  /** Fits the stage into a view of the given CSS pixel size. */
  resize(width: number, height: number): void;
  /** Tells which part of the pet lies under a point in CSS pixels, if any. */
  hitTest(x: number, y: number): HitRegion | null;
  /** Reports where the current drawing is opaque, on a grid of `cell` CSS pixels. */
  opaqueMask(cell: number): OpaqueMask | null;
  destroy(): void;
}
