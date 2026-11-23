import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { isLayerVisible, layerElapsedSeconds, layerMotionProgress } from "../../../appearance/layerTiming";
import { ACTION_SLOT } from "../../../assets/ArtPrompt";
import type { AnimationEntry } from "../../../assets/Manifest";
import { appearanceLayerSchema, loadAppearance, resetAppearance, saveAppearance, type ActionAppearance, type AppearanceLayer } from "../../../appearance/AppearanceStore";
import { petWindow } from "../../../platform/petWindow";
import { sampleAdjustedMotion, sampleMotion } from "../../../renderer/motions";
import { ConfirmButton } from "../../ConfirmButton";
import { NumberField } from "./NumberField";
import { setUnsavedChanges } from "../unsavedChanges";
import { LayerEditor } from "./LayerEditor";
import { CopyButton } from "./CopyButton";
import { PictureCropper } from "../PictureCropper";
import { SettingsBackButton } from "../SettingsBackButton";
import { placeFrames, readFirstFrame, type FirstFrame, type PickedFrames } from "./placePicture";
import type { PictureCrop } from "../../../appearance/pictureCrop";
import { cropFromPlacement, fittedPlacement, promptPlacement, restingPlacement, type Rect, type Size } from "../../../appearance/stagePlacement";
import { deleteUserAction, isUserAction, newUserActionId, saveUserAction, USER_ACTION_LIMITS } from "../../../actions/UserActions";
import { MOTION_PRESETS, type MotionPreset } from "../../../types";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SHEET_WIDTH = 8192;
const MOTION_LABELS: Record<MotionPreset, string> = { none: "无", breathe: "呼吸", bounce: "跳跃", sway: "摇摆", squash: "压缩", wiggle: "抖动", pop: "弹出", tilt: "歪头", nod: "点头", float: "上飘淡出" };
type Mode = "single" | "frames" | "sheet" | "grid";
interface Props { initialFile?: File; action: AnimationEntry; packId: string; /** Start empty instead of showing the borrowed picture: a custom character draws its own. */ blank?: boolean; /** What to paste into an image model to get this picture: filled in for a pack action, the bare template for the user's own. */ prompt: string; /** The character's idle picture as it shows now, to size this one by. */ reference?: { image: string; frames: number }; canvas: { width: number; height: number }; resolveAsset: (file: string) => string; onClose: () => void; onSaved: () => void; }

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("图片无法读取，请换一张图片")); image.src = src; });
}
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > MAX_FILE_BYTES) { reject(new Error("请选择不超过 4 MB 的 PNG、JPG 或 WebP 图片")); return; }
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(file);
  });
}

/** Picked pictures in the cropper, or placed already and open to adjust again. */
interface Picked extends PickedFrames { names: string[]; first: FirstFrame; crop: PictureCrop; fallback: PictureCrop; warning?: string }
/** The idle picture, read once, for the cropper's guides. */
interface Guide { frame: Size; visible: Rect }

const percent = (value: number, total: number) => `${(value / total) * 100}%`;

/** The action preview's size on the page, in CSS pixels; the canvas has a pixel per device pixel. */
const PREVIEW_SIZE = { width: 240, height: 210 };
/** How long one play lasts in the preview when the action has no length of its own. */
const PREVIEW_CYCLE_MS = 2000;

/** The picture as a PNG data URL, which is how pictures are stored. */
function asPng(image: HTMLImageElement, src: string): string {
  if (src.startsWith("data:image/png")) return src;
  const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d"); if (!context) throw new Error("无法处理图片");
  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

export function VisualPreview({ image, frames, fps, motion, loop, speed, strength, duration, layers, stage, align, randomFlip = false, resolveAsset, size = PREVIEW_SIZE }: { image: string; frames: number; fps: number; motion: MotionPreset; loop: boolean; speed: number; strength: number; duration?: number; layers: AppearanceLayer[]; stage: { width: number; height: number }; align: "left" | "center"; /** Shows both facings in turn, one play each. */ randomFlip?: boolean; resolveAsset: (file: string) => string; size?: { width: number; height: number } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const pixelRatio = Math.max(1, Math.round(window.devicePixelRatio || 1));
  useEffect(() => {
    let cancelled = false; let frame = 0; let start = 0;
    const sources = layers.map((layer) => "image" in layer.source ? layer.source.image : resolveAsset(layer.source.file));
    Promise.all([decode(image), ...sources.map(decode)]).then(([asset, ...layerImages]) => {
      const draw = (time: number) => {
        if (cancelled || !ref.current) return;
        if (!start) start = time;
        const canvas = ref.current; const ctx = canvas.getContext("2d"); if (!ctx) return;
        const elapsed = (time - start) / 1000;
        const count = Number.isInteger(frames) && frames >= 1 && frames <= 16 ? frames : 1;
        const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 1;
        const index = loop ? Math.floor(elapsed * safeFps) % count : Math.min(count - 1, Math.floor(elapsed * safeFps));
        const frameWidth = asset.naturalWidth / count; const frameHeight = asset.naturalHeight;
        const fit = Math.min(canvas.width / stage.width, canvas.height / stage.height);
        const cycle = duration ?? PREVIEW_CYCLE_MS;
        const progress = duration ? Math.min(1, elapsed * 1000 / duration) : (elapsed * 1000 % cycle) / cycle;
        const effect = sampleAdjustedMotion(motion, elapsed, progress, speed, strength);
        const center = align === "left" ? frameWidth / 2 : stage.width / 2;
        // On the desktop a left-aligned action's stage edge is the screen edge; the preview box's left side stands in for it.
        const stageLeft = align === "left" ? 0 : (canvas.width - stage.width * fit) / 2;
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save();
        ctx.translate(stageLeft, (canvas.height - stage.height * fit) / 2); ctx.scale(fit, fit);
        if (randomFlip && Math.floor(elapsed * 1000 / cycle) % 2 === 1) { ctx.translate(center * 2, 0); ctx.scale(-1, 1); }
        const drawLayer = (layer: AppearanceLayer, layerImage: HTMLImageElement) => {
          if (!isLayerVisible(layer, index, count)) return;
          const layerCount = Number.isInteger(layer.frames) && layer.frames > 0 ? layer.frames : 1;
          const layerFps = Number.isFinite(layer.fps) && layer.fps > 0 ? layer.fps : 1;
          const layerTime = layerElapsedSeconds(layer, elapsed, count, safeFps, loop);
          const n = Math.floor(layerTime * layerFps); const frameIndex = loop ? n % layerCount : Math.min(n, layerCount - 1);
          const width = layerImage.naturalWidth / layerCount; const height = layerImage.naturalHeight;
          const layerProgress = layerMotionProgress(layer, layerTime, count, safeFps, progress);
          const layerMotion = sampleMotion(layer.motion, layerTime, layerProgress);
          ctx.save(); ctx.globalAlpha = effect.alpha * layerMotion.alpha; ctx.translate(center + effect.x + layer.x + layerMotion.x, stage.height + effect.y + layer.y + layerMotion.y);
          ctx.rotate(effect.rotation + layer.rotation + layerMotion.rotation);
          ctx.scale(effect.scaleX * layer.scaleX * layerMotion.scaleX, effect.scaleY * layer.scaleY * layerMotion.scaleY);
          ctx.drawImage(layerImage, frameIndex * width, 0, width, height, -width / 2, -height, width, height); ctx.restore();
        };
        const order = layers.map((layer, i) => ({ layer, img: layerImages[i] })).sort((a, b) => a.layer.zIndex - b.layer.zIndex);
        for (const item of order.filter((item) => item.layer.zIndex < 0)) drawLayer(item.layer, item.img);
        ctx.save(); ctx.globalAlpha = effect.alpha; ctx.translate(center + effect.x, stage.height + effect.y); ctx.rotate(effect.rotation); ctx.scale(effect.scaleX, effect.scaleY);
        ctx.drawImage(asset, index * frameWidth, 0, frameWidth, frameHeight, -frameWidth / 2, -frameHeight, frameWidth, frameHeight); ctx.restore();
        for (const item of order.filter((item) => item.layer.zIndex >= 0)) drawLayer(item.layer, item.img);
        ctx.restore(); frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
    }).catch((error) => console.warn("Failed to load action preview", error));
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [image, frames, fps, motion, loop, speed, strength, duration, layers, stage, align, randomFlip, resolveAsset, pixelRatio]);
  return <canvas ref={ref} width={size.width * pixelRatio} height={size.height * pixelRatio} style={size} aria-label="动作动画预览" />;
}

/** Show the actual saved frame, including its transparent margins and shared placement. */
function FrameThumbnail({ image, frames, index }: { image: string; frames: number; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let active = true;
    void decode(image).then((asset) => {
      if (!active || !ref.current) return;
      const context = ref.current.getContext("2d");
      if (!context) return;
      const width = asset.naturalWidth / frames;
      const height = asset.naturalHeight;
      const scale = Math.min(ref.current.width / width, ref.current.height / height);
      context.clearRect(0, 0, ref.current.width, ref.current.height);
      context.drawImage(asset, index * width, 0, width, height, (ref.current.width - width * scale) / 2, (ref.current.height - height * scale) / 2, width * scale, height * scale);
    }).catch((reason: unknown) => console.warn("Could not load the frame thumbnail", reason));
    return () => { active = false; };
  }, [image, frames, index]);
  return <canvas ref={ref} width={144} height={144} aria-label={`第 ${index + 1} 帧图片`} />;
}

export function ActionEditor({ initialFile, action, packId, blank = false, prompt, reference, canvas, resolveAsset, onClose, onSaved }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>(initialFile && action.id === "wooden_fish" ? "grid" : action.frames > 1 && !blank ? "sheet" : "single");
  const [gridRows, setGridRows] = useState(2);
  const [gridColumns, setGridColumns] = useState(action.id === "wooden_fish" ? 3 : 2);
  const [gridSource, setGridSource] = useState<string | null>(null);
  const [image, setImage] = useState(blank ? "" : resolveAsset(action.file));
  const [frames, setFrames] = useState(action.frames);
  const [fps, setFps] = useState(action.fps);
  const [motion, setMotion] = useState<MotionPreset>(action.motion);
  const [loop, setLoop] = useState(action.loop);
  const [motionSpeed, setMotionSpeed] = useState(1);
  const [motionStrength, setMotionStrength] = useState(1);
  const [randomFlip, setRandomFlip] = useState(action.randomFlip);
  const [sourceNames, setSourceNames] = useState<string[]>([]);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [custom, setCustom] = useState(false);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [cropping, setCropping] = useState<Picked | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const align = action.align;
  const [layers, setLayers] = useState<AppearanceLayer[]>(() => action.layers.map(({ file, ...options }) => ({ source: { file }, ...options })));
  /** The user's own actions also have a name and a length; a new one has no id yet. */
  const own = isUserAction(action);
  const isNew = own && action.id === "";
  const [label, setLabel] = useState(action.label ?? "");
  const [seconds, setSeconds] = useState((action.duration ?? 0) / 1000);
  const duration = own ? Math.round(seconds * 1000) : action.duration;
  const title = isNew ? "新建动作" : `${blank && !custom ? "上传" : "编辑"}「${(own ? label.trim() : "") || action.label || action.id}」`;
  const actionName = (own ? label.trim() : "") || action.label || action.id || "新动作";
  /** Frame strips, frame rates and extra layers are for people who draw their own frames. */
  const [advanced, setAdvanced] = useState(!blank && (action.frames > 1 || action.layers.length > 0));
  /** What the editor held once loaded, to tell whether leaving would throw changes away. */
  const [baseline, setBaseline] = useState<string | null>(null);
  const snapshot = JSON.stringify({ mode, image, frames, fps, motion, loop, motionSpeed, motionStrength, randomFlip, layers, label, seconds });
  const dirty = baseline !== null && snapshot !== baseline;
  useEffect(() => { setUnsavedChanges(dirty); }, [dirty]);
  useEffect(() => () => setUnsavedChanges(false), []);
  useEffect(() => { if (!busy && baseline === null) setBaseline(snapshot); }, [busy, baseline, snapshot]);


  useEffect(() => {
    editorRef.current?.closest(".settings-content")?.scrollTo({ top: 0 });
  }, [action.id]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([isNew ? Promise.resolve(null) : loadAppearance(packId, action.id)]).then(([stored]) => {
      if (!active) return;
      if (stored.status === "rejected") {
        console.error("Could not read the saved picture", stored.reason);
        setCustom(true); setError("换过的图片没能读出来，可以点「恢复默认」改回原来的。");
      } else if (stored.value) {
        const saved = stored.value;
        setImage(saved.image); setFrames(saved.frames); setFps(saved.fps); setMotion(saved.motion); setMotionSpeed(saved.motionSpeed); setMotionStrength(saved.motionStrength); setRandomFlip(saved.randomFlip ?? action.randomFlip); setLoop(saved.loop); setMode(saved.frames > 1 ? "sheet" : "single");
        if (saved.layers) setLayers(saved.layers);
        if (saved.frames > 1 || (saved.layers?.length ?? 0) > 0) setAdvanced(true);
        setCustom(true);
      }
      setBusy(false);
    });
    return () => { active = false; };
  }, [action.id, packId, isNew]);

  /** Read once per reference; picking a picture waits for it, so the first placement never misses it. */
  const guideReady = useRef<Promise<Guide | null>>(Promise.resolve(null));
  useEffect(() => {
    let active = true;
    const read = async (): Promise<Guide | null> => {
      if (!reference) return null;
      const first = await readFirstFrame({ images: [reference.image], count: reference.frames });
      return first.visible ? { frame: first.frame, visible: first.visible } : null;
    };
    const ready = read().catch((reason: unknown) => { console.warn("Could not read the idle picture for the guides", reason); return null; });
    guideReady.current = ready;
    void ready.then((value) => { if (active) setGuide(value); });
    return () => { active = false; };
  }, [reference?.image, reference?.frames]);

  /** The size the pack's own picture of this action has: a picture of another shape is fitted to it. */
  const usualFrame = async (): Promise<Size> => {
    try {
      const original = await decode(resolveAsset(action.file));
      const width = original.naturalWidth / action.frames;
      return Number.isInteger(width) && width > 0 ? { width, height: original.naturalHeight } : canvas;
    } catch (reason) { console.warn("Could not read the action's own picture", reason); return canvas; }
  };

  /**
   * Where picked pictures start in the cropper. One already at stage scale stays
   * where the pet shows it; one drawn to the art prompt's square canvas gets
   * the idle picture's scale; anything else fills the action's usual frame.
   */
  const startingCrop = async (first: FirstFrame, staged: boolean): Promise<PictureCrop> => {
    if (staged) return cropFromPlacement(restingPlacement(first.frame, canvas, align), first.frame, canvas);
    const known = await guideReady.current;
    const placement = (known && promptPlacement(first.frame, canvas, align, known.visible.height, first.visible?.x))
      ?? fittedPlacement(first.visible ?? { x: 0, y: 0, ...first.frame }, await usualFrame(), canvas, align);
    return cropFromPlacement(placement, first.frame, canvas);
  };
  const openCropper = async (frames: PickedFrames, names: string[], staged: boolean): Promise<FirstFrame> => {
    const first = await readFirstFrame(frames);
    if (!first.visible) throw new Error("这张图片是全透明的，请换一张");
    const fallback = await startingCrop(first, staged);
    setCropping({ ...frames, names, first, crop: fallback, fallback, warning: first.opaque ? "这张图片没有透明像素，宠物可能会连底色一起显示。仍可继续调整位置。" : undefined });
    return first;
  };
  const placeCropped = async (target: Picked, crop: PictureCrop) => {
    setBusy(true); setError("");
    try {
      const sheet = await placeFrames(target, crop, canvas, align, MAX_SHEET_WIDTH);
      if (mode === "grid" && action.id === "wooden_fish" && target.count === 6 && !picked) { setFps(6); setLoop(true); }
      setImage(sheet); setFrames(target.count); setSourceNames(target.names); setPicked({ ...target, crop });
      if (target.count === 1) setLayers((current) => current.map((layer) => ({ ...layer, startFrame: undefined, endFrame: undefined })));
    } catch (reason) { console.error("Could not place the picture", reason); setError(reason instanceof Error && /[\u4e00-\u9fa5]/.test(reason.message) ? reason.message : "图片没能摆好，换一张试试。"); }
    finally { setCropping(null); setBusy(false); }
  };
  /** Opens the cropper again: on the pictures as picked if there are any, otherwise on the picture shown now. */
  const adjust = async () => {
    if (picked) { setCropping(picked); return; }
    setBusy(true); setError("");
    try { await openCropper({ images: [image], count: frames }, sourceNames, true); }
    catch (reason) { console.error("Could not open the picture to adjust it", reason); setError("这张图片没能打开，换一张试试。"); }
    finally { setBusy(false); }
  };
  /** A strip split another way is a new set of frames: place them again. */
  const changeSheetFrames = (count: number) => {
    setFrames(count);
    if (count === 1) setLayers((current) => current.map((layer) => ({ ...layer, startFrame: undefined, endFrame: undefined })));
    if (!picked || picked.images.length !== 1 || !Number.isInteger(count) || count < 1 || count > 16) return;
    setPicked(null);
    openCropper({ images: picked.images, count }, picked.names, false).catch((reason: unknown) => { console.warn("Could not split the strip", reason); setError(reason instanceof Error && /[\u4e00-\u9fa5]/.test(reason.message) ? reason.message : "帧图没能按这个帧数分开。"); });
  };

  /** Picking another kind keeps the picture until the user really picks new files; picking the same kind does nothing. */
  const changeMode = (value: Mode) => {
    if (value === mode) return;
    setMode(value); setSourceNames([]); setError("");
    if (value === "single") setLayers((current) => current.map((layer) => ({ ...layer, startFrame: undefined, endFrame: undefined })));
  };
  const processFiles = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true); setError("");
    try {
      if (mode !== "frames" && files.length !== 1) throw new Error("请选择一张图片");
      if (mode === "frames" && files.length > 16) throw new Error("选择的图片过多，最多 16 帧");
      const ordered = mode === "frames" ? [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) : files;
      const images = await Promise.all(ordered.map(readFile));
      if (mode === "frames" && images.length < 2) throw new Error("请至少选择两张逐帧图片");
      if (mode === "grid") {
        setGridSource(images[0]);
        await openGrid(images[0], gridRows, gridColumns, ordered[0].name);
        return;
      }
      const count = mode === "frames" ? images.length : mode === "sheet" ? frames : 1;
      if (!Number.isInteger(count) || count < 1 || count > 16) throw new Error("帧数请设置为 1 到 16 之间的整数。");
      await openCropper({ images, count }, ordered.map((file) => file.name), false);
    } catch (reason) { console.error("Could not read the picked pictures", reason); setError(reason instanceof Error && /[\u4e00-\u9fa5]/.test(reason.message) ? reason.message : "图片没能读出来，换一张试试。"); }
    finally { setBusy(false); }
  };
  const openGrid = async (src: string, rows: number, columns: number, name: string) => {
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rows * columns > 16 || rows * columns < 2) throw new Error("宫格需有 2 到 16 帧，请检查行数和列数。");
    const asset = await decode(src);
    if (asset.naturalWidth % columns || asset.naturalHeight % rows) throw new Error("图片宽高不能被列数和行数整除，请检查宫格设置。");
    const width = asset.naturalWidth / columns; const height = asset.naturalHeight / rows;
    const output = document.createElement("canvas"); output.width = width; output.height = height;
    const context = output.getContext("2d"); if (!context) throw new Error("无法处理图片");
    const images = Array.from({ length: rows * columns }, (_, index) => {
      context.clearRect(0, 0, width, height);
      context.drawImage(asset, (index % columns) * width, Math.floor(index / columns) * height, width, height, 0, 0, width, height);
      return output.toDataURL("image/png");
    });
    await openCropper({ images, count: images.length }, images.map((_, i) => `${name} · 第 ${i + 1} 帧`), false);
  };
  const initialHandled = useRef(false);
  useEffect(() => {
    if (!initialFile || busy || initialHandled.current) return;
    initialHandled.current = true;
    void processFiles([initialFile]);
  }, [initialFile, busy]);
  const selectFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = "";
    await processFiles(files);
  };
  const dragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault(); setDraggingFiles(true);
  };
  const dragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDraggingFiles(false);
  };
  const dropFiles = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault(); setDraggingFiles(false);
    void processFiles(Array.from(event.dataTransfer.files));
  };
  const editFrameOrder = async (index: number, direction: -1 | 0 | 1) => {
    if (!image || frames < 2) return;
    const target = index + direction;
    if (direction !== 0 && (target < 0 || target >= frames)) return;
    setBusy(true); setError("");
    try {
      const asset = await decode(image);
      const frameWidth = asset.naturalWidth / frames; const frameHeight = asset.naturalHeight;
      if (!Number.isInteger(frameWidth)) throw new Error("帧图的宽度必须能被帧数整除");
      const order = Array.from({ length: frames }, (_, i) => i);
      if (direction === 0) order.splice(index, 1);
      else [order[index], order[target]] = [order[target], order[index]];
      const output = document.createElement("canvas"); output.width = frameWidth * order.length; output.height = frameHeight;
      const context = output.getContext("2d"); if (!context) throw new Error("无法处理帧图");
      order.forEach((sourceIndex, outputIndex) => context.drawImage(asset, sourceIndex * frameWidth, 0, frameWidth, frameHeight, outputIndex * frameWidth, 0, frameWidth, frameHeight));
      setImage(output.toDataURL("image/png")); setPicked(null);
      setSourceNames(order.map((sourceIndex) => sourceNames[sourceIndex] ?? `第 ${sourceIndex + 1} 帧`));
      setFrames(order.length);
      if (order.length === 1) setLayers((current) => current.map((layer) => ({ ...layer, startFrame: undefined, endFrame: undefined })));
    } catch (reason) { console.error("Could not reorder the frames", reason); setError(reason instanceof Error && /[\u4e00-\u9fa5]/.test(reason.message) ? reason.message : "没能调整帧顺序，请再试一次。"); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!image) { setError("请先选择素材图片"); return; }
    if (!Number.isInteger(frames) || frames < 1 || frames > 16) { setError("帧数请设置为 1 到 16 之间的整数。"); return; }
    if (!Number.isFinite(fps) || fps < 1 || fps > 30) { setError("播放速度请设置为每秒 1 到 30 帧。"); return; }
    if (own && !label.trim()) { setError("给动作起个名字。"); return; }
    if (own && (!Number.isFinite(seconds) || seconds * 1000 < USER_ACTION_LIMITS.minDuration || seconds * 1000 > USER_ACTION_LIMITS.maxDuration)) { setError(`播放时长请设置为 ${USER_ACTION_LIMITS.minDuration / 1000} 到 ${USER_ACTION_LIMITS.maxDuration / 1000} 秒。`); return; }
    setBusy(true); setError("");
    const id = action.id || newUserActionId();
    try {
      const mainFrames = frames;
      for (const layer of layers) {
        const parsed = appearanceLayerSchema.safeParse(layer);
        if (!parsed.success) throw new Error(`图层“${layer.name || "未命名"}”的参数无效，请检查帧数、位置和缩放。`);
        if ((layer.startFrame ?? 1) > mainFrames || (layer.endFrame ?? mainFrames) > mainFrames) throw new Error(`图层“${layer.name || "未命名"}”的显示帧范围超出主图帧数。`);
        const layerImage = await decode("image" in layer.source ? layer.source.image : resolveAsset(layer.source.file));
        if (layerImage.naturalWidth % layer.frames !== 0) throw new Error(`图层“${layer.name || "未命名"}”的图片宽度不能被帧数整除。`);
      }
      const decoded = await decode(image);
      if (decoded.naturalWidth % mainFrames !== 0) throw new Error("帧图的宽度必须能被帧数整除。");
      const value: ActionAppearance = { image: asPng(decoded, image), frames: mainFrames, fps, motion, motionSpeed, motionStrength, loop, randomFlip, layers };
      await saveAppearance(packId, id, value);
      if (own) {
        try { saveUserAction(packId, { id, label: label.trim(), duration: Math.round(seconds * 1000) }); }
        catch (reason) { if (isNew) await resetAppearance(packId, id); throw reason; }
      }
      try { await petWindow.notifyAppearanceChanged(id); } catch {
        setError("图片已经保存，但宠物没有回应，重启 AI Pet 后生效。"); setCustom(true); onSaved(); setBaseline(snapshot);
        // The new action now exists; staying here would save it a second time under another id.
        if (isNew) onClose();
        return;
      }
      setCustom(true); setUnsavedChanges(false); onSaved(); onClose();
    } catch (reason) {
      console.error("Could not save the action", reason);
      setError(reason instanceof Error && /[\u4e00-\u9fa5]/.test(reason.message) ? `没能保存：${reason.message}` : "没能保存。图片太大或存储空间不够时会这样，换一张小一些的图片再试。");
    }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError("");
    try {
      deleteUserAction(packId, action.id);
      await resetAppearance(packId, action.id);
    } catch (reason) { console.error("Could not delete the action", reason); setError("没能删除，请再试一次。"); setBusy(false); return; }
    onSaved();
    // The action is gone either way; a pet that does not answer drops it on its next start.
    await petWindow.notifyAppearanceChanged(action.id).catch((reason: unknown) => console.warn("The pet did not drop the deleted action", reason));
    onClose();
  };
  const restore = async () => {
    setBusy(true); setError("");
    try { await resetAppearance(packId, action.id); setUnsavedChanges(false); onSaved(); await petWindow.notifyAppearanceChanged(action.id); onClose(); }
    catch (reason) { console.error("Could not restore the action", reason); setError("没能恢复，或者宠物没有回应。可以再试一次，或者重启 AI Pet。"); }
    finally { setBusy(false); }
  };
  return <div ref={editorRef} className="action-editor" aria-label={title}>
    <div className="action-editor__header">
      <SettingsBackButton destination="动作库" disabled={busy} confirm={dirty ? { message: "放弃对这个动作的改动？", detail: "还没保存的名称、图片和动效会丢掉。", action: "放弃改动" } : undefined} onBack={onClose} />
      <h2>{title}</h2>
      <p>{own ? "起个名字，选好图片和动效。做好后可以在动作库播放，也能放进快捷按钮。" : blank ? `这张画的是：${action.pose ?? action.description ?? "这个动作的样子"}` : "替换外观，宠物原来的触发方式会保留。"}</p>
    </div>
    {own && <fieldset className="action-editor__group" disabled={busy}><legend>动作</legend>
      <label className="action-editor__field">名称<input type="text" className="action-editor__name" value={label} maxLength={USER_ACTION_LIMITS.label} placeholder="比如：转圈圈" onChange={(e) => setLabel(e.currentTarget.value)} /></label>
      <label className="action-editor__field">播放时长 <span><NumberField min={USER_ACTION_LIMITS.minDuration / 1000} max={USER_ACTION_LIMITS.maxDuration / 1000} step={0.5} value={seconds} onChange={setSeconds} /> 秒</span></label>
    </fieldset>}
    <fieldset className="action-editor__group action-editor__materials" disabled={busy}><legend>动作图片</legend><div className="action-editor__types" role="group" aria-label="素材类型">{([ ["single", "单张图片"], ["frames", "多张图片"], ["sheet", "一排多格"], ["grid", "多行多列"] ] as const).map(([value, label]) => <button key={value} type="button" className={mode === value ? "is-selected" : ""} aria-pressed={mode === value} disabled={busy} onClick={() => changeMode(value)}>{label}</button>)}</div><p className="action-editor__mode-note">{mode === "single" ? "一张图片配合动效，例如呼吸或摇摆。" : mode === "frames" ? "选择多张同尺寸图片，按文件名数字顺序播放。" : mode === "sheet" ? "一张图里横排着几个画面，每格一样宽。" : "一张图里排着几行几列画面，按从左到右、从上到下播放，位置统一调整。"}</p>
      {mode === "grid" && <div className="action-editor__field"><label>行数 <NumberField min={1} max={16} value={gridRows} onChange={setGridRows} /></label><label>列数 <NumberField min={1} max={16} value={gridColumns} onChange={setGridColumns} /></label>{gridSource && <button type="button" className="settings-button" onClick={() => { setError(""); void openGrid(gridSource, gridRows, gridColumns, sourceNames[0]?.split(" · ")[0] ?? "宫格图片").catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "这张图片没法按这个行列数拆分")); }}>重新拆分并调整位置</button>}</div>}
      {mode === "sheet" && <label className="action-editor__field">帧数<NumberField min={1} max={16} value={frames} onChange={changeSheetFrames} /></label>}
      <div className={draggingFiles ? "action-editor__dropzone is-dragging" : "action-editor__dropzone"} onClick={(event) => { if (event.target === event.currentTarget || event.target instanceof HTMLSpanElement && !event.target.closest("label")) fileRef.current?.click(); }} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={dropFiles}>
        <label className="action-editor__upload"><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple={mode === "frames"} onChange={(e) => void selectFiles(e)} /><span>{image ? "更换图片" : mode === "frames" ? "选择多张图片" : "选择图片"}</span></label>
        {image && <button type="button" className="settings-button action-editor__adjust" disabled={busy} onClick={() => void adjust()}>调整位置</button>}
        <span className="action-editor__drop-hint">或把图片拖到这里</span>
        <span className="action-editor__format">支持 PNG、JPG、WebP；建议透明 PNG，每张不超过 4 MB。选好后调整位置和大小。</span>
        {sourceNames.length > 0 && <span className="action-editor__file-meta" title={sourceNames.join("、")}>{mode === "frames" ? `已选 ${sourceNames.length} 张图片` : sourceNames[0]}</span>}
      </div>
      <div className="action-editor__prompt-row"><span>{own ? "还没准备好图片？" : "需要重新生成这张图？"}</span><CopyButton className="settings-link action-editor__prompt" text={prompt} title={own ? `粘贴到 ChatGPT 后，把 ${ACTION_SLOT} 换成想要的姿势` : "和角色的图一起发给 ChatGPT，画出这一张"} onMessage={setError}>{own ? "复制提示词模板" : "复制这张图的提示词"}</CopyButton></div>
      {image && frames > 1 && Number.isInteger(frames) && frames <= 16 && <div className="action-editor__sequence">
        <div className="action-editor__sequence-head"><strong>帧顺序</strong><span>按顺序播放，可调整或删除</span></div>
        <div className="action-editor__frames" aria-label="帧顺序">{Array.from({ length: frames }, (_, index) => <div key={index}><FrameThumbnail image={image} frames={frames} index={index} /><span title={sourceNames[index] ?? `第 ${index + 1} 帧`}>第 {index + 1} 帧</span><div className="action-editor__frame-controls"><button type="button" disabled={busy || index === 0} aria-label={`第 ${index + 1} 帧前移`} onClick={() => void editFrameOrder(index, -1)}>←</button><button type="button" disabled={busy || index === frames - 1} aria-label={`第 ${index + 1} 帧后移`} onClick={() => void editFrameOrder(index, 1)}>→</button><button type="button" disabled={busy} aria-label={`删除第 ${index + 1} 帧`} onClick={() => void editFrameOrder(index, 0)}>×</button></div></div>)}</div>
        <label className="action-editor__field">播放速度 <span><NumberField min={1} max={30} value={fps} onChange={setFps} /> 帧 / 秒</span></label>
        <label className="action-editor__field">循环播放 <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.currentTarget.checked)} /></label>
        {duration && fps > 0 && (frames - 1) / fps * 1000 > duration && <p className="settings-error">这个动作会在 {(duration / 1000).toFixed(1)} 秒后结束，当前速度可能播放不到最后一帧。可以{own ? "加长播放时长、" : ""}提高帧速或减少帧数。</p>}
      </div>}
    </fieldset>
    <div className="action-editor__preview"><span className="action-editor__preview-label">动作预览</span>{image ? <><div className="action-editor__stage" style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}><VisualPreview key={previewVersion} image={image} frames={frames} fps={fps} motion={motion} loop={loop} speed={motionSpeed} strength={motionStrength} duration={duration} layers={layers} stage={canvas} align={action.align} randomFlip={randomFlip} resolveAsset={resolveAsset} size={{ width: 240, height: Math.round(240 * canvas.height / canvas.width) }} /></div><button type="button" className="action-editor__replay" onClick={() => setPreviewVersion((value) => value + 1)}>重新播放</button></> : <span>选择图片后在这里预览</span>}</div>
    <fieldset className="action-editor__group action-editor__motion" disabled={busy}><legend>动效</legend>
      <label className="action-editor__field">图片动效 <select value={motion} onChange={(e) => setMotion(e.currentTarget.value as MotionPreset)}>{MOTION_PRESETS.map((value) => <option key={value} value={value}>{MOTION_LABELS[value]}</option>)}</select></label>
      {action.align !== "left" && <><label className="action-editor__field">随机朝左或朝右 <input type="checkbox" checked={randomFlip} onChange={(e) => setRandomFlip(e.currentTarget.checked)} /></label>
      <p>每次播放随机左右镜像，一张图就能朝两边。发夹这类只戴在一侧的饰品，镜像时会换到另一边。</p></>}
      {!own && <p>触发时机和持续时间由宠物行为决定。</p>}
    </fieldset>
    <details className="action-editor__advanced" open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
      <summary>更多设置：动效幅度、图层</summary>
      {advanced && <div className="action-editor__advanced-content">
        {motion !== "none" && <><label className="action-editor__field">动效速度 <span><input type="range" min="0.25" max="3" step="0.05" value={motionSpeed} onChange={(e) => setMotionSpeed(Number(e.currentTarget.value))} /> {motionSpeed.toFixed(2)}×</span></label><label className="action-editor__field">动效幅度 <span><input type="range" min="0" max="2" step="0.05" value={motionStrength} onChange={(e) => setMotionStrength(Number(e.currentTarget.value))} /> {Math.round(motionStrength * 100)}%</span></label></>}
        <LayerEditor layers={layers} frames={mode === "single" ? 1 : frames} canvas={canvas} resolveAsset={resolveAsset} onChange={setLayers} onError={setError} busy={busy} onBusyChange={setBusy} />
      </div>}
    </details>
    {error && <p className="settings-error" role="alert">{error}</p>}
    {cropping && <PictureCropper title={`摆好「${actionName}」`} src={cropping.first.display} crop={cropping.crop} fallback={cropping.fallback} frameAspect={canvas.width / canvas.height} round={false} large warning={cropping.warning}
      hint={`拖动调整位置，滚轮或滑块缩放。站姿头顶对齐虚线，脚踩地面线。${align === "left" ? "探头动作靠左边缘。" : ""}`}
      guide={<StageGuide guide={guide} stage={canvas} />}
      onCancel={() => setCropping(null)} onConfirm={(crop) => void placeCropped(cropping, crop)} />}
    <div className="action-editor__footer">
      {!own && <ConfirmButton disabled={!custom || busy} confirm={{ message: "改回原来的图片？", detail: "换上的图片会删掉，宠物重新用角色自带的样子。", action: "恢复默认" }} onConfirm={() => void restore()}>恢复默认</ConfirmButton>}
      {own && !isNew && <ConfirmButton className="is-danger" disabled={busy} confirm={{ message: `删除动作「${label || action.id}」？`, detail: "图片一起删掉，快捷按钮里的这个动作也会去掉。删除后不能恢复。", action: "删除" }} onConfirm={() => void remove()}>删除动作</ConfirmButton>}
      {dirty
        ? <ConfirmButton disabled={busy} confirm={{ message: "放弃对这个动作的改动？", detail: "还没保存的名称、图片和动效会丢掉。", action: "放弃改动" }} onConfirm={onClose}>取消</ConfirmButton>
        : <button type="button" disabled={busy} onClick={onClose}>取消</button>}
      <button type="button" className="save-button" disabled={busy} onClick={() => void save()}>{busy ? "处理中…" : isNew ? "创建动作" : "保存并应用"}</button>
    </div>
  </div>;
}

/** The cropper's guides, in the frame's terms: the ground and the idle picture's height. */
function StageGuide({ guide, stage }: { guide: Guide | null; stage: Size }) {
  return <span className="stage-guide" aria-hidden="true">
    {guide && <span className="stage-guide__line is-head" style={{ top: percent(stage.height - guide.frame.height + guide.visible.y, stage.height) }}><em>待机身高</em></span>}
    <span className="stage-guide__line is-ground"><em>地面</em></span>
  </span>;
}
