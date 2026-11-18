/** Transparent margin kept around the drawing, as in the bundled assets. */
const TRIM_PADDING = 2;
const OPAQUE = 255;

export interface Bounds { x: number; y: number; width: number; height: number }

/**
 * Scans RGBA pixels for the rectangle that holds every visible pixel, padded and kept inside the image.
 * `bounds` is null when nothing is visible; `opaque` is true when no pixel is see-through at all.
 */
export function visibleBounds(pixels: ArrayLike<number>, width: number, height: number, padding = TRIM_PADDING): { bounds: Bounds | null; opaque: boolean } {
  let left = width, top = height, right = -1, bottom = -1, opaque = true;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha !== OPAQUE) opaque = false;
      if (alpha === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) return { bounds: null, opaque };
  const x = Math.max(0, left - padding), y = Math.max(0, top - padding);
  return { bounds: { x, y, width: Math.min(width, right + padding + 1) - x, height: Math.min(height, bottom + padding + 1) - y }, opaque };
}

/**
 * Decodes through an image element, not `fetch`: the app's CSP lets images load
 * `data:` URLs but blocks `fetch` from reading them.
 */
export function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => resolve(picture);
    picture.onerror = () => reject(new Error("Could not decode the picture"));
    picture.src = source;
  });
}
