import type { PictureCrop } from "../../appearance/pictureCrop";
import { keptRegion, placementFromCrop, unionRect, type Rect, type Size, type StageAlign } from "../../appearance/stagePlacement";
import { loadImage, visibleBounds } from "./trimImage";

/** Pictures as the user picked them: one strip of `count` equal frames, or one picture per frame. */
export interface PickedFrames { images: string[]; count: number }

/** What the first frame of picked pictures is like, to place it. */
export interface FirstFrame {
  frame: Size;
  /** What it shows, in its own pixels; null when it is all see-through. */
  visible: Rect | null;
  /** No pixel is see-through: the background was not taken out. */
  opaque: boolean;
  /** That frame on its own, for the cropper. */
  display: string;
}

function blankCanvas(size: Size): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法处理图片");
  context.imageSmoothingQuality = "high";
  return { canvas, context };
}

async function decodeFrames(picked: PickedFrames): Promise<{ images: HTMLImageElement[]; frame: Size }> {
  const images = await Promise.all(picked.images.map(loadImage));
  const several = images.length > 1;
  const frame = { width: several ? images[0].naturalWidth : images[0].naturalWidth / picked.count, height: images[0].naturalHeight };
  if (!Number.isInteger(frame.width) || frame.width < 1) throw new Error("帧图的宽度必须能被帧数整除");
  if (several && images.some((image) => image.naturalWidth !== frame.width || image.naturalHeight !== frame.height)) throw new Error("逐帧图片的宽高必须相同，避免播放时抖动");
  return { images, frame };
}

/** Draws frame `index` of the pictures with its top-left corner at (left, top), `scale` times its size. */
function drawFrame(context: CanvasRenderingContext2D, images: HTMLImageElement[], frame: Size, index: number, left: number, top: number, scale: number): void {
  const several = images.length > 1;
  context.drawImage(several ? images[index] : images[0], several ? 0 : index * frame.width, 0, frame.width, frame.height, left, top, frame.width * scale, frame.height * scale);
}

export async function readFirstFrame(picked: PickedFrames): Promise<FirstFrame> {
  const { images, frame } = await decodeFrames(picked);
  const { canvas, context } = blankCanvas(frame);
  drawFrame(context, images, frame, 0, 0, 0, 1);
  const { bounds, opaque } = visibleBounds(context.getImageData(0, 0, frame.width, frame.height).data, frame.width, frame.height);
  const strip = picked.images.length === 1 && picked.count > 1;
  return { frame, visible: bounds, opaque, display: strip ? canvas.toDataURL("image/png") : picked.images[0] };
}

/**
 * Draws every frame where the crop puts it on the stage, then saves the part of
 * the stage they cover as one strip of equal frames. The renderer anchors the
 * strip where it was cut from, so the character shows exactly as placed.
 */
export async function placeFrames(picked: PickedFrames, crop: PictureCrop, stage: Size, align: StageAlign, maxWidth: number): Promise<string> {
  const { images, frame } = await decodeFrames(picked);
  const placement = placementFromCrop(crop, frame, stage);
  const staged = Array.from({ length: picked.count }, (_, index) => {
    const { canvas, context } = blankCanvas(stage);
    drawFrame(context, images, frame, index, placement.left, placement.top, placement.scale);
    return { canvas, visible: visibleBounds(context.getImageData(0, 0, stage.width, stage.height).data, stage.width, stage.height).bounds };
  });
  const visible = staged.reduce<Rect | null>((all, item) => unionRect(all, item.visible), null);
  if (!visible) throw new Error("图片整个在画框外面，把它拖回框里再点「确定」。");
  const region = keptRegion(visible, stage, align);
  if (region.width * picked.count > maxWidth) throw new Error("帧数太多，超出当前宠物画布允许的大小");
  const { canvas, context } = blankCanvas({ width: region.width * picked.count, height: region.height });
  staged.forEach((item, index) => context.drawImage(item.canvas, region.x, region.y, region.width, region.height, index * region.width, 0, region.width, region.height));
  return canvas.toDataURL("image/png");
}
