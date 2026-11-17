import { useState, type ChangeEvent } from "react";
import { appearanceLayerSchema, type AppearanceLayer } from "../../appearance/AppearanceStore";
import { MOTION_PRESETS, type MotionPreset } from "../../types";

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const LABELS: Record<MotionPreset, string> = { none: "无", breathe: "呼吸", bounce: "跳跃", sway: "摇摆", squash: "压缩", wiggle: "抖动", pop: "弹出", tilt: "歪头", nod: "点头", float: "上飘淡出" };
interface Props {
  layers: AppearanceLayer[];
  frames: number;
  canvas: { width: number; height: number };
  resolveAsset: (file: string) => string;
  onChange: (layers: AppearanceLayer[]) => void;
  onError: (message: string) => void;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
}

export function LayerEditor({ layers, frames, canvas, resolveAsset, onChange, onError, busy, onBusyChange }: Props) {
  const [text, setText] = useState("功德 +1");
  const update = (index: number, next: Partial<AppearanceLayer>) => onChange(layers.map((layer, i) => i === index ? { ...layer, ...next } : layer));
  const move = (index: number, offset: number) => {
    const next = [...layers];
    const target = index + offset;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const select = (event: ChangeEvent<HTMLInputElement>, index: number | null) => {
    const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > MAX_FILE_BYTES) { onError("图层图片需为不超过 4 MB 的 PNG、JPG 或 WebP。请优先使用透明 PNG。"); return; }
    onBusyChange(true);
    const reader = new FileReader();
    reader.onerror = () => { onBusyChange(false); onError("图层图片读取失败，请重试。"); };
    reader.onload = () => {
      if (typeof reader.result !== "string") { onBusyChange(false); onError("图层图片读取失败，请重试。"); return; }
      const src = reader.result;
      const image = new Image();
      image.onerror = () => { onBusyChange(false); onError("图片无法解码，请选择其他图片。"); };
      image.onload = () => {
        onBusyChange(false);
        if (image.naturalWidth > 8192 || image.naturalHeight > 4096) { onError("图层图片尺寸过大，请缩小至宽不超过 8192、高不超过 4096 像素。"); return; }
        const source = { image: src };
        if (index !== null) { update(index, { source, frames: 1 }); onError(""); return; }
        const defaults = appearanceLayerSchema.parse({ name: file.name.replace(/\.[^.]+$/, "").slice(0, 30), source, frames: 1, fps: 12, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, zIndex: 1, motion: "none", startFrame: frames > 1 ? 1 : undefined });
        onChange([...layers, defaults]); onError("");
      };
      image.src = src;
    };
    reader.readAsDataURL(file);
  };
  const addText = () => {
    const value = text.trim();
    if (!value) { onError("请输入要显示的文字。"); return; }
    const picture = document.createElement("canvas"); picture.width = 400; picture.height = 100;
    const context = picture.getContext("2d");
    if (!context) { onError("文字图片无法生成，请再试一次。"); return; }
    context.font = "bold 46px system-ui, sans-serif"; context.textAlign = "center"; context.textBaseline = "middle";
    context.lineJoin = "round"; context.lineWidth = 9; context.strokeStyle = "#ffffff"; context.fillStyle = "#d99725";
    context.strokeText(value, 200, 50, 370); context.fillText(value, 200, 50, 370);
    const startFrame = Math.min(frames, 4);
    const layer = appearanceLayerSchema.parse({ name: value.slice(0, 30), source: { image: picture.toDataURL("image/png") }, frames: 1, fps: 12, x: 0, y: -canvas.height * 0.7, scaleX: 0.6, scaleY: 0.6, rotation: 0, zIndex: 1, motion: "float", startFrame: frames > 1 ? startFrame : undefined, endFrame: frames > 1 ? frames : undefined });
    onChange([...layers, layer]); onError("");
  };
  return <fieldset className="action-editor__group layer-editor" disabled={busy}><legend>叠加图层</legend>
    <p>为角色添加独立图片，例如木鱼、装饰或“功德 +1”文字。相同层级按列表顺序叠放；透明 PNG 效果最佳。</p>
    {layers.map((layer, index) => <article className="layer-card" key={index}>
      <header><img src={"image" in layer.source ? layer.source.image : resolveAsset(layer.source.file)} alt="" /><label>图层名称<input maxLength={30} value={layer.name ?? `图层 ${index + 1}`} onChange={(event) => update(index, { name: event.currentTarget.value })} /></label><button type="button" aria-label={`上移图层 ${layer.name || index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`下移图层 ${layer.name || index + 1}`} disabled={index === layers.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" onClick={() => onChange(layers.filter((_, i) => i !== index))}>移除</button></header>
      <div className="layer-card__fields">
        <label>左右位置<input type="number" min={-4096} max={4096} step={1} value={layer.x} onChange={(event) => update(index, { x: Number(event.currentTarget.value) })} /></label>
        <label>上下位置<input type="number" min={-4096} max={4096} step={1} value={layer.y} onChange={(event) => update(index, { y: Number(event.currentTarget.value) })} /></label>
        <label>缩放倍数<input type="number" min={0.05} max={5} step={0.05} value={layer.scaleX} onChange={(event) => update(index, { scaleX: Number(event.currentTarget.value), scaleY: Number(event.currentTarget.value) })} /></label>
        <label>旋转角度<input type="number" min={-360} max={360} step={1} value={Math.round(layer.rotation * 180 / Math.PI)} onChange={(event) => update(index, { rotation: Number(event.currentTarget.value) * Math.PI / 180 })} /></label>
        <label>前后层级<select value={layer.zIndex < 0 ? "behind" : "front"} onChange={(event) => update(index, { zIndex: event.currentTarget.value === "behind" ? -1 : 1 })}><option value="front">角色前面</option><option value="behind">角色后面</option></select></label>
        <label>图片动效<select value={layer.motion} onChange={(event) => update(index, { motion: event.currentTarget.value as MotionPreset })}>{MOTION_PRESETS.map((value) => <option value={value} key={value}>{LABELS[value]}</option>)}</select></label>
        <label>图层帧数<input type="number" min={1} max={16} value={layer.frames} onChange={(event) => update(index, { frames: Number(event.currentTarget.value) })} /></label>
        {layer.frames > 1 && <label>图层帧速<input type="number" min={1} max={30} value={layer.fps} onChange={(event) => update(index, { fps: Number(event.currentTarget.value) })} /></label>}
        {frames > 1 && <><label>从主图第几帧显示<input type="number" min={1} max={frames} value={layer.startFrame ?? 1} onChange={(event) => update(index, { startFrame: Number(event.currentTarget.value) })} /></label><label>显示到主图第几帧<input type="number" min={1} max={frames} value={layer.endFrame ?? frames} onChange={(event) => update(index, { endFrame: Number(event.currentTarget.value) })} /></label></>}
      </div>
      <label className="action-editor__upload"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => select(event, index)} />替换图层图片</label>
      <p>坐标单位为原图像素（画布 {canvas.width} × {canvas.height}）；横向帧图可设置图层帧数。</p>
    </article>)}
    {layers.length < 8 && <div className="layer-editor__text"><label>飘字内容 <input value={text} maxLength={20} onChange={(event) => setText(event.currentTarget.value)} /></label><button type="button" className="settings-button" onClick={addText}>添加飘字</button><span>默认从第 4 帧开始上飘淡出，可在下方调整。</span></div>}
    {layers.length < 8 && <label className="action-editor__upload"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => select(event, null)} />添加图片图层</label>}
    {layers.length === 0 && <p>暂未添加图层。</p>}
  </fieldset>;
}
