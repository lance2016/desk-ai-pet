import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode, type WheelEvent } from "react";
import { CROP_LIMITS, panCrop, zoomCrop, type PictureCrop } from "../../appearance/pictureCrop";

interface Props {
  title: string;
  src: string;
  /** Where the editor starts. */
  crop: PictureCrop;
  /** What "重置" goes back to. */
  fallback: PictureCrop;
  /** Width over height of the frame. */
  frameAspect: number;
  round: boolean;
  /** A bigger view, for placing a whole character rather than a face. */
  large?: boolean;
  /** Replaces the usual one-line instruction. */
  hint?: string;
  /** A file check that should be visible before the user applies the placement. */
  warning?: string;
  /** Drawn over the frame, positioned in its terms: lines and outlines to line the picture up with. */
  guide?: ReactNode;
  onCancel: () => void;
  onConfirm: (crop: PictureCrop) => void;
}

const VIEW = { width: 320, height: 260 } as const;
const LARGE_VIEW = { width: 330, height: 330 } as const;
const FRAME_WIDTH = { round: 200, box: 220, large: 280 } as const;
const WHEEL_SPEED = 0.0015;
const KEY_STEP_PX = 4;
const KEY_ZOOM = 1.1;
/** The slider works on a log scale so each step feels the same at any size. */
const SLIDER = { min: -Math.log(CROP_LIMITS.maxZoom), max: -Math.log(CROP_LIMITS.minZoom) } as const;

/** Drag to move, scroll or slide to zoom; the frame shows exactly what the chat will show. */
export function PictureCropper({ title, src, crop: initial, fallback, frameAspect, round, large = false, hint, warning, guide, onCancel, onConfirm }: Props) {
  const [crop, setCrop] = useState(initial);
  const [viewScale, setViewScale] = useState(1);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const view = useRef<HTMLDivElement>(null);
  const viewSize = large ? LARGE_VIEW : VIEW;
  const frameWidth = large ? FRAME_WIDTH.large : round ? FRAME_WIDTH.round : FRAME_WIDTH.box;
  const frameHeight = frameWidth / frameAspect;
  const frameLeft = (viewSize.width - frameWidth) / 2;
  const frameTop = (viewSize.height - frameHeight) / 2;
  const pictureWidth = frameWidth / crop.zoom;
  const picture = {
    width: pictureWidth,
    left: frameLeft + frameWidth / 2 - crop.x * pictureWidth,
    top: frameTop + frameHeight / 2 - crop.y * pictureWidth * crop.ratio,
  };
  useEffect(() => {
    const fitView = () => setViewScale(Math.max(0.5, Math.min(1, (window.innerHeight - 260) / viewSize.height, (window.innerWidth - 72) / viewSize.width)));
    fitView();
    window.addEventListener("resize", fitView);
    return () => window.removeEventListener("resize", fitView);
  }, [viewSize.height, viewSize.width]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY };
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const last = drag.current;
    if (!last) return;
    drag.current = { x: event.clientX, y: event.clientY };
    setCrop((current) => panCrop(current, (event.clientX - last.x) / viewScale, (event.clientY - last.y) / viewScale, frameWidth));
  };
  const pointerUp = () => { drag.current = null; };
  const wheel = (event: WheelEvent<HTMLDivElement>) => setCrop((current) => zoomCrop(current, Math.exp(event.deltaY * WHEEL_SPEED)));
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = { ArrowLeft: [-KEY_STEP_PX, 0], ArrowRight: [KEY_STEP_PX, 0], ArrowUp: [0, -KEY_STEP_PX], ArrowDown: [0, KEY_STEP_PX] };
    const move = moves[event.key];
    if (move) { event.preventDefault(); setCrop((current) => panCrop(current, move[0] / viewScale, move[1] / viewScale, frameWidth)); }
    else if (event.key === "+" || event.key === "=") setCrop((current) => zoomCrop(current, 1 / KEY_ZOOM));
    else if (event.key === "-") setCrop((current) => zoomCrop(current, KEY_ZOOM));
  };
  // The picture is ready to move with the keyboard as soon as the cropper opens; Esc closes it from anywhere in it.
  useEffect(() => { view.current?.focus(); }, []);
  const escape = (event: KeyboardEvent<HTMLDivElement>) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } };

  return <div className="cropper" role="dialog" aria-modal="true" aria-labelledby="cropper-title" onKeyDown={escape}>
    <div className={large ? "cropper__card is-large" : "cropper__card"}>
      <h2 id="cropper-title">{title}</h2>
      <p>{hint ?? "拖动图片调整位置，滚动或拖动下方滑块缩放。"}</p>
      <div ref={view} className="cropper__view" style={{ width: viewSize.width * viewScale, height: viewSize.height * viewScale }} tabIndex={0} aria-label="拖动调整图片位置，方向键微调，加减号缩放"
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={wheel} onKeyDown={key}>
        <img src={src} alt="" draggable={false} style={{ width: picture.width * viewScale, left: picture.left * viewScale, top: picture.top * viewScale }} />
        <span className={round ? "cropper__frame is-round" : "cropper__frame"} style={{ width: frameWidth * viewScale, height: frameHeight * viewScale, left: frameLeft * viewScale, top: frameTop * viewScale }}>{guide}</span>
      </div>
      {warning && <p className="cropper__warning" role="status">{warning}</p>}
      <label className="cropper__zoom"><span>缩小</span>
        <input type="range" min={SLIDER.min} max={SLIDER.max} step="any" value={-Math.log(crop.zoom)} aria-label="缩放" onChange={(event) => { const zoom = Math.exp(-Number(event.currentTarget.value)); setCrop((current) => ({ ...current, zoom })); }} />
        <span>放大</span></label>
      <div className="cropper__actions">
        <button type="button" className="cropper__reset" onClick={() => setCrop(fallback)}>重置</button>
        <button type="button" onClick={onCancel}>取消</button>
        <button type="button" className="is-primary" onClick={() => onConfirm(crop)}>应用</button>
      </div>
    </div>
  </div>;
}
