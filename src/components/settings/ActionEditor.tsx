import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { isLayerVisible, layerElapsedSeconds, layerMotionProgress } from "../../appearance/layerTiming";
import type { AnimationEntry } from "../../assets/Manifest";
import { appearanceLayerSchema, loadAppearance, resetAppearance, saveAppearance, type ActionAppearance, type AppearanceLayer } from "../../appearance/AppearanceStore";
import { petWindow } from "../../platform/petWindow";
import { sampleAdjustedMotion, sampleMotion } from "../../renderer/motions";
import { ConfirmButton } from "../ConfirmButton";
import { NumberField } from "./NumberField";
import { setUnsavedChanges } from "./unsavedChanges";
import { LayerEditor } from "./LayerEditor";
import { trimTransparentEdges } from "./trimImage";
import { deleteUserAction, isUserAction, newUserActionId, saveUserAction, USER_ACTION_LIMITS } from "../../actions/UserActions";
import { MOTION_PRESETS, type MotionPreset } from "../../types";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SHEET_WIDTH = 8192;
const MOTION_LABELS: Record<MotionPreset, string> = { none: "无", breathe: "呼吸", bounce: "跳跃", sway: "摇摆", squash: "压缩", wiggle: "抖动", pop: "弹出", tilt: "歪头", nod: "点头" };
type Mode = "single" | "frames" | "sheet";
interface Props { action: AnimationEntry; packId: string; /** Start empty instead of showing the borrowed picture: a custom character draws its own. */ blank?: boolean; canvas: { width: number; height: number }; resolveAsset: (file: string) => string; onClose: () => void; onSaved: () => void; }

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("图片无法读取，请换一张图片")); image.src = src; });
}
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > MAX_FILE_BYTES) { reject(new Error("请选择不超过 4 MB 的 PNG、JPG 或 WebP 图片")); return; }
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("图片读取失败")); reader.readAsDataURL(file);
  });
}

/** Normalize uploaded frames to the original frame size, preserving aspect and bottom alignment. */
async function makeSheet(sources: string[], sourceFrames: number, stage: { width: number; height: number }): Promise<string> {
  const images = await Promise.all(sources.map(decode));
  const count = sources.length > 1 ? sources.length : sourceFrames;
  if (!Number.isInteger(count) || count < 1 || count > 16 || stage.width * count > MAX_SHEET_WIDTH) throw new Error("帧数太多，超出当前宠物画布允许的大小");
  if (sources.length === 1 && images[0].naturalWidth % count !== 0) throw new Error("帧图的宽度必须能被帧数整除");
  if (sources.length > 1 && images.some((image) => image.naturalWidth !== images[0].naturalWidth || image.naturalHeight !== images[0].naturalHeight)) throw new Error("逐帧图片的宽高必须相同，避免播放时抖动");
  const output = document.createElement("canvas"); output.width = stage.width * count; output.height = stage.height;
  const ctx = output.getContext("2d"); if (!ctx) throw new Error("无法处理图片");
  for (let index = 0; index < count; index += 1) {
    const image = images[sources.length > 1 ? index : 0];
    const width = image.naturalWidth / (sources.length > 1 ? 1 : count);
    const height = image.naturalHeight;
    const scale = Math.min(stage.width / width, stage.height / height);
    ctx.drawImage(image, sources.length > 1 ? 0 : index * width, 0, width, height, index * stage.width + (stage.width - width * scale) / 2, stage.height - height * scale, width * scale, height * scale);
  }
  return output.toDataURL("image/png");
}

function VisualPreview({ image, frames, fps, motion, loop, speed, strength, duration, layers, stage, align, resolveAsset }: { image: string; frames: number; fps: number; motion: MotionPreset; loop: boolean; speed: number; strength: number; duration?: number; layers: AppearanceLayer[]; stage: { width: number; height: number }; align: "left" | "center"; resolveAsset: (file: string) => string }) {
  const ref = useRef<HTMLCanvasElement>(null);
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
        const fit = Math.min(canvas.width / stage.width, canvas.height / stage.height) * .9;
        const progress = duration ? Math.min(1, elapsed * 1000 / duration) : (elapsed % 2) / 2;
        const effect = sampleAdjustedMotion(motion, elapsed, progress, speed, strength);
        const center = align === "left" ? frameWidth / 2 : stage.width / 2;
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.save();
        ctx.translate((canvas.width - stage.width * fit) / 2, canvas.height * .95 - stage.height * fit); ctx.scale(fit, fit);
        const drawLayer = (layer: AppearanceLayer, layerImage: HTMLImageElement) => {
          if (!isLayerVisible(layer, index, count)) return;
          const layerCount = Number.isInteger(layer.frames) && layer.frames > 0 ? layer.frames : 1;
          const layerFps = Number.isFinite(layer.fps) && layer.fps > 0 ? layer.fps : 1;
          const layerTime = layerElapsedSeconds(layer, elapsed, count, safeFps, loop);
          const n = Math.floor(layerTime * layerFps); const frameIndex = loop ? n % layerCount : Math.min(n, layerCount - 1);
          const width = layerImage.naturalWidth / layerCount; const height = layerImage.naturalHeight;
          const layerProgress = layerMotionProgress(layer, layerTime, count, safeFps, progress);
          const layerMotion = sampleMotion(layer.motion, layerTime, layerProgress);
          ctx.save(); ctx.translate(center + effect.x + layer.x + layerMotion.x, stage.height + effect.y + layer.y + layerMotion.y);
          ctx.rotate(effect.rotation + layer.rotation + layerMotion.rotation);
          ctx.scale(effect.scaleX * layer.scaleX * layerMotion.scaleX, effect.scaleY * layer.scaleY * layerMotion.scaleY);
          ctx.drawImage(layerImage, frameIndex * width, 0, width, height, -width / 2, -height, width, height); ctx.restore();
        };
        const order = layers.map((layer, i) => ({ layer, img: layerImages[i] })).sort((a, b) => a.layer.zIndex - b.layer.zIndex);
        for (const item of order.filter((item) => item.layer.zIndex < 0)) drawLayer(item.layer, item.img);
        ctx.save(); ctx.translate(center + effect.x, stage.height + effect.y); ctx.rotate(effect.rotation); ctx.scale(effect.scaleX, effect.scaleY);
        ctx.drawImage(asset, index * frameWidth, 0, frameWidth, frameHeight, -frameWidth / 2, -frameHeight, frameWidth, frameHeight); ctx.restore();
        for (const item of order.filter((item) => item.layer.zIndex >= 0)) drawLayer(item.layer, item.img);
        ctx.restore(); frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
    }).catch((error) => console.warn("Failed to load action preview", error));
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [image, frames, fps, motion, loop, speed, strength, duration, layers, stage, align, resolveAsset]);
  return <canvas ref={ref} width={240} height={210} aria-label="动作动画预览" />;
}

export function ActionEditor({ action, packId, blank = false, canvas, resolveAsset, onClose, onSaved }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState(canvas);
  const [mode, setMode] = useState<Mode>(action.frames > 1 && !blank ? "sheet" : "single");
  const [image, setImage] = useState(blank ? "" : resolveAsset(action.file));
  const [frames, setFrames] = useState(action.frames);
  const [fps, setFps] = useState(action.fps);
  const [motion, setMotion] = useState<MotionPreset>(action.motion);
  const [loop, setLoop] = useState(action.loop);
  const [motionSpeed, setMotionSpeed] = useState(1);
  const [motionStrength, setMotionStrength] = useState(1);
  const [sourceNames, setSourceNames] = useState<string[]>([]);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [custom, setCustom] = useState(false);
  const [layers, setLayers] = useState<AppearanceLayer[]>(() => action.layers.map(({ file, ...options }) => ({ source: { file }, ...options })));
  /** The user's own actions also have a name and a length; a new one has no id yet. */
  const own = isUserAction(action);
  const isNew = own && action.id === "";
  const [label, setLabel] = useState(action.label ?? "");
  const [seconds, setSeconds] = useState((action.duration ?? 0) / 1000);
  const duration = own ? Math.round(seconds * 1000) : action.duration;
  const title = isNew ? "新建动作" : `${blank && !custom ? "上传" : "编辑"}「${(own ? label.trim() : "") || action.label || action.id}」`;
  /** Frame strips, frame rates and extra layers are for people who draw their own frames. */
  const [advanced, setAdvanced] = useState(!blank && (action.frames > 1 || action.layers.length > 0));
  /** What the editor held once loaded, to tell whether leaving would throw changes away. */
  const [baseline, setBaseline] = useState<string | null>(null);
  const snapshot = JSON.stringify({ mode, image, frames, fps, motion, loop, motionSpeed, motionStrength, layers, label, seconds });
  const dirty = baseline !== null && snapshot !== baseline;
  useEffect(() => { setUnsavedChanges(dirty); }, [dirty]);
  useEffect(() => () => setUnsavedChanges(false), []);
  useEffect(() => { if (!busy && baseline === null) setBaseline(snapshot); }, [busy, baseline, snapshot]);


  useEffect(() => {
    editorRef.current?.closest(".settings-content")?.scrollTo({ top: 0 });
  }, [action.id]);

  useEffect(() => {
    let active = true;
    Promise.allSettled([decode(resolveAsset(action.file)), isNew ? Promise.resolve(null) : loadAppearance(packId, action.id)]).then(([original, stored]) => {
      if (!active) return;
      if (original.status === "fulfilled") {
        const width = original.value.naturalWidth / action.frames;
        if (Number.isInteger(width) && width > 0) setFrameSize({ width, height: original.value.naturalHeight });
      }
      if (stored.status === "rejected") {
        console.error("Could not read the saved picture", stored.reason);
        setCustom(true); setError("换过的图片没能读出来，可以点「恢复默认」改回原来的。");
      } else if (stored.value) {
        const saved = stored.value;
        setImage(saved.image); setFrames(saved.frames); setFps(saved.fps); setMotion(saved.motion); setMotionSpeed(saved.motionSpeed); setMotionStrength(saved.motionStrength); setLoop(saved.loop); setMode(saved.frames > 1 ? "sheet" : "single");
        if (saved.layers) setLayers(saved.layers);
        if (saved.frames > 1 || (saved.layers?.length ?? 0) > 0) setAdvanced(true);
        setCustom(true);
      }
      setBusy(false);
    });
    return () => { active = false; };
  }, [action.id, action.file, action.frames, packId, resolveAsset, isNew]);

  /** Picking another kind keeps the picture until the user really picks new files; picking the same kind does nothing. */
  const changeMode = (value: Mode) => {
    if (value === mode) return;
    setMode(value); setSourceNames([]); setError("");
    if (value === "single") setLayers((current) => current.map((layer) => ({ ...layer, startFrame: undefined, endFrame: undefined })));
  };
  const selectFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ""; if (!files.length) return;
    setBusy(true); setError("");
    try {
      if (mode !== "frames" && files.length !== 1) throw new Error("请选择一张图片");
      if (mode === "frames" && (files.length > 16 || files.length * frameSize.width > MAX_SHEET_WIDTH)) throw new Error("选择的图片过多，超出当前动作允许的帧数");
      const ordered = mode === "frames" ? [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) : files;
      const picked = await Promise.all(ordered.map(readFile));
      // Frames are left as they are: trimming each one on its own would make them jump.
      const trimmed = mode === "single" ? await trimTransparentEdges(picked[0]) : null;
      const sources = trimmed ? [trimmed.image] : picked;
      if (mode === "frames" && sources.length < 2) throw new Error("请至少选择两张逐帧图片");
      const count = mode === "frames" ? sources.length : mode === "sheet" ? frames : 1;
      const sheet = mode === "sheet" ? sources[0] : await makeSheet(sources, count, frameSize);
      if (mode === "sheet") { const decoded = await decode(sheet); if (!Number.isInteger(count) || count < 1 || decoded.naturalWidth % count !== 0) throw new Error("帧图的宽度必须能被帧数整除"); }
      setImage(sheet); setFrames(count); setSourceNames(ordered.map((file) => file.name));
      if (trimmed?.opaque) setError("这张图没有透明背景，宠物会连着底色一起显示。可以先去掉背景再上传。");
    } catch (reason) { console.error("Could not read the picked pictures", reason); setError(reason instanceof Error && /[\u4e00-\u9fa5]/.test(reason.message) ? reason.message : "图片没能读出来，换一张试试。"); }
    finally { setBusy(false); }
  };
  const editFrameOrder = async (index: number, direction: -1 | 0 | 1) => {
    if (!image || frames < 2) return;
    const target = index + direction;
    if (direction !== 0 && (target < 0 || target >= frames)) return;
    setBusy(true); setError("");
    try {
      const normalized = await makeSheet([image], frames, frameSize);
      const asset = await decode(normalized);
      const order = Array.from({ length: frames }, (_, i) => i);
      if (direction === 0) order.splice(index, 1);
      else [order[index], order[target]] = [order[target], order[index]];
      const output = document.createElement("canvas"); output.width = frameSize.width * order.length; output.height = frameSize.height;
      const context = output.getContext("2d"); if (!context) throw new Error("无法处理帧图");
      order.forEach((sourceIndex, outputIndex) => context.drawImage(asset, sourceIndex * frameSize.width, 0, frameSize.width, frameSize.height, outputIndex * frameSize.width, 0, frameSize.width, frameSize.height));
      setImage(output.toDataURL("image/png"));
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
      const mainFrames = mode === "single" ? 1 : frames;
      for (const layer of layers) {
        const parsed = appearanceLayerSchema.safeParse(layer);
        if (!parsed.success) throw new Error(`图层“${layer.name || "未命名"}”的参数无效，请检查帧数、位置和缩放。`);
        if ((layer.startFrame ?? 1) > mainFrames || (layer.endFrame ?? mainFrames) > mainFrames) throw new Error(`图层“${layer.name || "未命名"}”的显示帧范围超出主图帧数。`);
        const layerImage = await decode("image" in layer.source ? layer.source.image : resolveAsset(layer.source.file));
        if (layerImage.naturalWidth % layer.frames !== 0) throw new Error(`图层“${layer.name || "未命名"}”的图片宽度不能被帧数整除。`);
      }
      const normalized = await makeSheet([image], mainFrames, frameSize);
      const value: ActionAppearance = { image: normalized, frames: mainFrames, fps, motion, motionSpeed, motionStrength, loop, layers };
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
    <div className="action-editor__header"><div>{dirty
      ? <ConfirmButton className="action-editor__back" disabled={busy} confirmLabel="再点一次，放弃改动" onConfirm={onClose}>‹ 返回动作库</ConfirmButton>
      : <button type="button" className="action-editor__back" disabled={busy} onClick={onClose}>‹ 返回动作库</button>}<h2>{title}</h2><p>{own ? "起个名字，选好图片和动效。做好后可以在动作库播放，也能放进快捷按钮。" : blank ? `这张画的是：${action.pose ?? action.description ?? "这个动作的样子"}` : "替换外观，宠物原来的触发方式会保留。"}</p></div></div>
    <div className="action-editor__preview">{image ? <><VisualPreview key={previewVersion} image={image} frames={frames} fps={fps} motion={motion} loop={loop} speed={motionSpeed} strength={motionStrength} duration={duration} layers={layers} stage={canvas} align={action.align} resolveAsset={resolveAsset} /><button type="button" className="action-editor__replay" onClick={() => setPreviewVersion((value) => value + 1)}>重新预览</button></> : <span>选择图片后预览</span>}</div>
    {own && <fieldset className="action-editor__group" disabled={busy}><legend>动作</legend>
      <label className="action-editor__field">名称<input type="text" className="action-editor__name" value={label} maxLength={USER_ACTION_LIMITS.label} placeholder="比如：转圈圈" onChange={(e) => setLabel(e.currentTarget.value)} /></label>
      <label className="action-editor__field">播放时长 <span><NumberField min={USER_ACTION_LIMITS.minDuration / 1000} max={USER_ACTION_LIMITS.maxDuration / 1000} step={0.5} value={seconds} onChange={setSeconds} /> 秒</span></label>
    </fieldset>}
    <fieldset className="action-editor__group" disabled={busy}><legend>素材类型</legend><div className="action-editor__types">{([ ["single", "单张图片"], ["frames", "多张逐帧"], ["sheet", "横向帧图"] ] as const).filter(([value]) => value !== "sheet" || advanced || mode === "sheet").map(([value, label]) => <button key={value} type="button" className={mode === value ? "is-selected" : ""} aria-pressed={mode === value} disabled={busy} onClick={() => changeMode(value)}>{label}</button>)}</div><p>{mode === "single" ? "一张图片配合动效，例如呼吸或摇摆。" : mode === "frames" ? "选择多张相同尺寸的图片，按文件名数字顺序播放。" : "使用横向排列、每帧等宽的图片，例如现有的木鱼素材。"}</p>
      {mode === "sheet" && <label className="action-editor__field">帧数<NumberField min={1} max={16} value={frames} onChange={(count) => { setFrames(count); if (count === 1) setLayers((current) => current.map((layer) => ({ ...layer, startFrame: undefined, endFrame: undefined }))); }} /></label>}
      <p>建议使用透明背景的 PNG，单张图片不超过 4 MB；图片会按原动作尺寸等比适配。</p>
      <label className="action-editor__upload"><input type="file" accept="image/png,image/jpeg,image/webp" multiple={mode === "frames"} onChange={(e) => void selectFiles(e)} />选择{mode === "frames" ? "逐帧图片" : "图片"}</label>
      {mode !== "single" && image && frames > 1 && Number.isInteger(frames) && frames <= 16 && <div className="action-editor__frames" aria-label="帧顺序">{Array.from({ length: frames }, (_, index) => <div key={index}><span title={sourceNames[index] ?? `第 ${index + 1} 帧`}>{sourceNames[index] ?? `第 ${index + 1} 帧`}</span><button type="button" disabled={busy || index === 0} aria-label={`第 ${index + 1} 帧前移`} onClick={() => void editFrameOrder(index, -1)}>↑</button><button type="button" disabled={busy || index === frames - 1} aria-label={`第 ${index + 1} 帧后移`} onClick={() => void editFrameOrder(index, 1)}>↓</button><button type="button" disabled={busy} aria-label={`删除第 ${index + 1} 帧`} onClick={() => void editFrameOrder(index, 0)}>×</button></div>)}</div>}
    </fieldset>
    <fieldset className="action-editor__group" disabled={busy}><legend>播放效果</legend>
      {mode !== "single" && advanced && <><label className="action-editor__field">播放速度 <span><NumberField min={1} max={30} value={fps} onChange={setFps} /> 帧 / 秒</span></label><label className="action-editor__field">循环播放 <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.currentTarget.checked)} /></label></>}
      <label className="action-editor__field">图片动效 <select value={motion} onChange={(e) => setMotion(e.currentTarget.value as MotionPreset)}>{MOTION_PRESETS.map((value) => <option key={value} value={value}>{MOTION_LABELS[value]}</option>)}</select></label>
      {motion !== "none" && <><label className="action-editor__field">动效速度 <span><input type="range" min="0.25" max="3" step="0.05" value={motionSpeed} onChange={(e) => setMotionSpeed(Number(e.currentTarget.value))} /> {motionSpeed.toFixed(2)}×</span></label><label className="action-editor__field">动效幅度 <span><input type="range" min="0" max="2" step="0.05" value={motionStrength} onChange={(e) => setMotionStrength(Number(e.currentTarget.value))} /> {Math.round(motionStrength * 100)}%</span></label></>}
      {!own && <p>动作的持续时间和触发时机由宠物行为决定。</p>}
      {mode !== "single" && duration && frames > 1 && fps > 0 && (frames - 1) / fps * 1000 > duration && <p className="settings-error">这个动作会在 {(duration / 1000).toFixed(1)} 秒后结束，当前速度可能播放不到最后一帧。可以{own ? "加长播放时长、" : ""}提高帧速或减少帧数。</p>}
    </fieldset>
    <details className="action-editor__advanced" open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
      <summary>高级：横向帧图、帧速、叠加图层</summary>
      {advanced && <LayerEditor layers={layers} frames={mode === "single" ? 1 : frames} canvas={canvas} resolveAsset={resolveAsset} onChange={setLayers} onError={setError} busy={busy} onBusyChange={setBusy} />}
    </details>
    {error && <p className="settings-error" role="alert">{error}</p>}
    <div className="action-editor__footer">
      {!own && <ConfirmButton disabled={!custom || busy} confirmLabel="再点一次，改回原来的图片" onConfirm={() => void restore()}>恢复默认</ConfirmButton>}
      {own && !isNew && <ConfirmButton className="is-danger" disabled={busy} confirmLabel="再点一次删除" onConfirm={() => void remove()}>删除动作</ConfirmButton>}
      {dirty
        ? <ConfirmButton disabled={busy} confirmLabel="再点一次，放弃改动" onConfirm={onClose}>取消</ConfirmButton>
        : <button type="button" disabled={busy} onClick={onClose}>取消</button>}
      <button type="button" className="save-button" disabled={busy} onClick={() => void save()}>{busy ? "处理中…" : isNew ? "创建动作" : "保存并应用"}</button>
    </div>
  </div>;
}
