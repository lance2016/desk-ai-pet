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
 * Cuts the empty margin around a picture, so a drawing made on a large canvas (as image models do)
 * fills the action's frame and stands on the ground instead of floating.
 */
export async function trimTransparentEdges(source: string): Promise<{ image: string; opaque: boolean }> {
  const bitmap = await createImageBitmap(await (await fetch(source)).blob());
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片");
    context.drawImage(bitmap, 0, 0);
    const { bounds, opaque } = visibleBounds(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (!bounds) throw new Error("这张图片是全透明的，请换一张");
    if (bounds.width === canvas.width && bounds.height === canvas.height) return { image: source, opaque };
    const output = document.createElement("canvas");
    output.width = bounds.width; output.height = bounds.height;
    output.getContext("2d")?.drawImage(canvas, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    return { image: output.toDataURL("image/png"), opaque };
  } finally { bitmap.close(); }
}
