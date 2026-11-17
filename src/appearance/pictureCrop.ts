/**
 * Where a picture sits inside a frame (the round avatar, the peeking character's box).
 *
 * `x`, `y`: the point of the picture shown at the frame's centre, as fractions of its width and height.
 * `zoom`: the frame's width as a fraction of the picture's width (smaller shows less, larger).
 * `ratio`: the picture's height divided by its width, so the crop can be drawn without loading it first.
 */
export interface PictureCrop { x: number; y: number; zoom: number; ratio: number }

export const CROP_LIMITS = { minZoom: 0.05, maxZoom: 2 } as const;
/** The old fixed head crop: the picture 1.7 times the frame's width, its top 4% below the frame's top. */
const HEAD_SCALE = 1.7;
const HEAD_TOP_PERCENT = 4;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The middle of the picture, just large enough to fill the frame. */
export function coverCrop(ratio: number, frameAspect: number): PictureCrop {
  return { x: 0.5, y: 0.5, zoom: Math.min(1, ratio * frameAspect), ratio };
}

/** The head of a full-body action image, as the chat has always shown it. */
export function headCrop(ratio: number, frameAspect: number): PictureCrop {
  const zoom = 1 / HEAD_SCALE;
  return { x: 0.5, y: ((50 - HEAD_TOP_PERCENT) * zoom) / (100 * ratio * frameAspect), zoom, ratio };
}

/** The top of the picture across the frame's full width, as the peeking character has always been shown. */
export function topCrop(ratio: number, frameAspect: number): PictureCrop {
  return { x: 0.5, y: 0.5 / (ratio * frameAspect), zoom: 1, ratio };
}

/** CSS for an absolutely positioned `<img>` inside the frame; `frameAspect` is the frame's width over its height. */
export function cropStyle(crop: PictureCrop, frameAspect: number): { width: string; left: string; top: string } {
  const scale = 100 / crop.zoom;
  return { width: `${scale}%`, left: `${50 - crop.x * scale}%`, top: `${50 - crop.y * crop.ratio * frameAspect * scale}%` };
}

/** Moves the picture by a drag of `dx`, `dy` pixels in a frame `frameWidth` pixels wide. */
export function panCrop(crop: PictureCrop, dx: number, dy: number, frameWidth: number): PictureCrop {
  const pictureWidth = frameWidth / crop.zoom;
  return { ...crop, x: clamp(crop.x - dx / pictureWidth, 0, 1), y: clamp(crop.y - dy / (pictureWidth * crop.ratio), 0, 1) };
}

/** Scales the frame's share of the picture by `factor`: below 1 zooms in, above 1 zooms out. */
export function zoomCrop(crop: PictureCrop, factor: number): PictureCrop {
  return { ...crop, zoom: clamp(crop.zoom * factor, CROP_LIMITS.minZoom, CROP_LIMITS.maxZoom) };
}
