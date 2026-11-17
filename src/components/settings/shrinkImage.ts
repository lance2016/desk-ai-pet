const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const JPEG_QUALITY = 0.88;
const OPAQUE = 255;

function isOpaque(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let alpha = 3; alpha < pixels.length; alpha += 4) if (pixels[alpha] !== OPAQUE) return false;
  return true;
}

/**
 * Reads a picked image and scales it down so its longer side is at most `maxSide` pixels.
 * Returns a data URL (JPEG when fully opaque, else PNG to keep transparency) and height / width.
 */
export async function shrinkImage(file: File, maxSide: number): Promise<{ dataUrl: string; ratio: number }> {
  if (!ACCEPTED_TYPES.includes(file.type)) throw new Error("请选择 PNG、JPG 或 WebP 图片。");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("图片太大了，请选择 8 MB 以内的图片。");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理这张图片。");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = isOpaque(context, canvas.width, canvas.height) ? canvas.toDataURL("image/jpeg", JPEG_QUALITY) : canvas.toDataURL("image/png");
    return { dataUrl, ratio: canvas.height / canvas.width };
  } finally { bitmap.close(); }
}
