import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent } from "react";
import type { AnimationEntry, PetControl } from "../../assets/Manifest";
import type { DisplayPreferences } from "../../preferences/DisplayPreferences";
import { canShortcut } from "../../preferences/ActionPreferences";
import { characterPictures } from "../../appearance/characterPictures";
import { PORTRAIT_ACTION } from "../../assets/PackCatalog";
import { barLayout, DOCK_LIMITS, dockControls, loadDock, resetDock, saveDock, setDockAction, subscribeDock, type DockCommand, type DockItem } from "../../preferences/DockPreferences";
import type { ControlIconPreset } from "../../types";
import { InteractIcon } from "../ControlIcon";
import { ControlIconView } from "../ControlIconView";
import { DockButtonFace } from "../DockButtonFace";
import { ConfirmButton } from "../ConfirmButton";
import { shrinkImage } from "./shrinkImage";
import { moveRadioChoice } from "./radioKeys";

/** Uploaded icons are scaled down to this side, so they do not fill up local storage. */
const ICON_MAX_SIDE = 128;
const ICON_OPTIONS: Record<DockCommand, ControlIconPreset[]> = {
  today_open: ["bell", "checklist", "timer"],
  notes_open: ["note", "clipboard", "book"],
  focus_toggle: ["timer", "hourglass", "book"],
  feed: ["feed", "carrot", "gift"],
  wooden_fish: ["wooden_fish", "mallet", "bell"],
  sleep_toggle: ["rest", "bed", "sun"],
};
const DESCRIPTIONS: Record<DockCommand, string> = {
  today_open: "打开提醒列表",
  notes_open: "打开备忘列表",
  focus_toggle: "开始 25 分钟专注",
  feed: "给宠物喂点吃的",
  wooden_fish: "播放木鱼动作",
  sleep_toggle: "让宠物睡觉或醒来",
};
/** What each icon is called, for screen readers. */
const ICON_NAMES: Record<ControlIconPreset, string> = {
  feed: "饭碗", carrot: "胡萝卜", gift: "礼物", wooden_fish: "木鱼", mallet: "木槌", bell: "铃铛", rest: "月亮", bed: "床",
  sun: "太阳", timer: "计时器", hourglass: "沙漏", book: "书", sparkle: "星星", chat: "对话", checklist: "清单", note: "便签", clipboard: "剪贴板",
};
const LINGER_OPTIONS = [{ value: 400, label: "快" }, { value: 700, label: "标准" }, { value: 1200, label: "慢" }] as const;

type ControlItem = Extract<DockItem, { kind: "control" }>;
const keyOf = (item: DockItem) => `${item.kind}:${item.id}`;

interface Props {
  packId: string;
  controls: PetControl[];
  actions: AnimationEntry[];
  resolveAsset: (file: string) => string;
  controlsLingerMs: DisplayPreferences["controlsLingerMs"];
  onControlsLingerChange: (value: DisplayPreferences["controlsLingerMs"]) => void;
  onError: (message: string | null) => void;
}

/** Every floating pet control in one list: show or hide, drag to reorder, rename and change icons. Changes apply at once. */
export function DockSettings({ packId, controls, actions, resolveAsset, controlsLingerMs, onControlsLingerChange, onError }: Props) {
  const load = () => loadDock(packId, dockControls(controls), actions);
  const [items, setItems] = useState<DockItem[]>(load);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  /** The character as it looks now; undefined while reading, null when it has no picture of its own yet. */
  const [portrait, setPortrait] = useState<string | null | undefined>(undefined);
  const rows = useRef(new Map<string, HTMLLIElement>());
  // Another window (or the action library) may change the dock; follow it unless a drag is under way.
  const draggingRef = useRef(false);
  draggingRef.current = dragging !== null;
  useEffect(() => subscribeDock(packId, () => { if (!draggingRef.current) setItems(loadDock(packId, dockControls(controls), actions)); }), [packId, controls, actions]);

  const commit = (next: DockItem[]) => {
    setItems(next);
    try {
      saveDock(packId, next);
      onError(null);
    } catch (reason) {
      console.error("Could not save the dock", reason);
      onError("快捷按钮没能保存。自定义图标太多时会存不下，删掉几张再试。");
    }
  };
  const update = (key: string, change: Partial<ControlItem>) => commit(items.map((item) => (keyOf(item) === key && item.kind === "control" ? { ...item, ...change } : item)));
  const toggle = (key: string) => commit(items.map((item) => (keyOf(item) === key ? { ...item, enabled: !item.enabled } : item)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || to === from) return items;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
  };

  // Reordering follows the pointer rather than HTML drag and drop, which the native window may intercept.
  const startDrag = (event: PointerEvent<HTMLSpanElement>, key: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(key);
    setExpanded(null);
  };
  const dragMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (!dragging) return;
    const from = items.findIndex((item) => keyOf(item) === dragging);
    const to = items.findIndex((item) => {
      const rect = rows.current.get(keyOf(item))?.getBoundingClientRect();
      return rect !== undefined && event.clientY < rect.top + rect.height / 2;
    });
    const target = to === -1 ? items.length - 1 : to > from ? to - 1 : to;
    if (target !== from) setItems(move(from, target));
  };
  const endDrag = () => {
    if (!dragging) return;
    setDragging(null);
    commit(items);
  };
  const handleKeys = (event: KeyboardEvent<HTMLSpanElement>, index: number) => {
    const offset = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!offset) return;
    event.preventDefault();
    const next = move(index, index + offset);
    if (next !== items) commit(next);
  };

  const uploadIcon = async (event: ChangeEvent<HTMLInputElement>, key: string) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      const { dataUrl } = await shrinkImage(file, ICON_MAX_SIDE);
      update(key, { icon: { dataUrl } });
    } catch (reason) {
      console.error("Could not read the icon", reason);
      onError(reason instanceof Error && /图片/.test(reason.message) ? reason.message : "图标没能读出来，换一张图片试试。");
    }
  };

  const restoreDefaults = () => {
    try {
      resetDock(packId);
      setItems(load());
      setExpanded(null);
      onError(null);
    } catch (reason) {
      console.error("Could not restore the default dock", reason);
      onError("没能恢复默认，请再试一次。");
    }
  };

  const actionOf = (id: string) => actions.find((action) => action.id === id);
  const idle = actions.find((action) => action.id === PORTRAIT_ACTION);
  const idleFile = idle ? resolveAsset(idle.file) : null;
  useEffect(() => {
    let active = true;
    const packImages: Record<string, string> = idleFile ? { [PORTRAIT_ACTION]: idleFile } : {};
    void characterPictures(packId, packImages, [PORTRAIT_ACTION]).then((pictures) => { if (active) setPortrait(pictures[PORTRAIT_ACTION] ?? null); });
    return () => { active = false; };
  }, [packId, idleFile]);
  const labelOf = (item: DockItem) => (item.kind === "control" ? item.label : actionOf(item.id)?.label ?? item.id);
  const addable = actions.filter((action) => canShortcut(action) && !items.some((item) => item.kind === "action" && item.id === action.id));
  const shown = items.filter((item) => item.enabled);
  const preview = barLayout(shown);

  const editor = (item: ControlItem) => {
    const key = keyOf(item);
    const defaults = dockControls(controls).find((control) => control.id === item.id);
    return (
      <div className="dock-editor">
        <label className="dock-editor__field">
          <span>名称</span>
          <input key={item.label} className="settings-field" defaultValue={item.label} maxLength={DOCK_LIMITS.label} placeholder={defaults?.label}
            onBlur={(event) => { const label = event.currentTarget.value.trim(); if (label !== item.label) update(key, { label: label || defaults?.label || item.label }); }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        </label>
        <div className="dock-editor__field">
          <span>图标</span>
          <div className="dock-editor__icons" role="radiogroup" onKeyDown={moveRadioChoice} aria-label={`${item.label}的图标`}>
            {ICON_OPTIONS[item.command].map((icon) => (
              <button key={icon} type="button" role="radio" aria-checked={item.icon === icon} aria-label={ICON_NAMES[icon]} className={item.icon === icon ? "icon-choice is-selected" : "icon-choice"} onClick={() => update(key, { icon })}><DockButtonFace item={{ ...item, icon }} packId={packId} actions={actions} resolveAsset={resolveAsset} /></button>
            ))}
            {typeof item.icon !== "string" && <span className="icon-choice is-selected" aria-label="自定义图标"><ControlIconView icon={item.icon} resolveAsset={resolveAsset} /></span>}
            <label className="settings-button settings-button--small icon-upload">
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadIcon(event, key)} />
              上传图片…
            </label>
          </div>
        </div>
        {defaults && (item.label !== defaults.label || item.icon !== defaults.icon) && (
          <button type="button" className="settings-link" onClick={() => update(key, { label: defaults.label, icon: defaults.icon })}>恢复这个按钮的默认名称和图标</button>
        )}
      </div>
    );
  };

  return (
    <div className="settings-section dock-settings">
      <div className="dock-preview" aria-label="快捷按钮预览">
        <div className="dock-preview__scene">
          {portrait
            ? <img className="dock-preview__pet" src={portrait} alt="宠物预览" />
            : <span className="dock-preview__pet-placeholder">{portrait === null && <>还没有自己的图片<br />去「动作库」上传</>}</span>}
          {shown.length > 0
            ? <div className="dock-preview__bar">
              {preview.menu.length > 0 && <span className="dock-preview__item"><InteractIcon /><span>互动</span></span>}
              {preview.bar.map((item) => <span key={keyOf(item)} className="dock-preview__item"><DockButtonFace item={item} packId={packId} actions={actions} resolveAsset={resolveAsset} /><span>{labelOf(item)}</span></span>)}
            </div>
            : <span className="dock-preview__empty">没有显示的快捷按钮</span>}
        </div>
        <p>圆形按钮轻轻浮在宠物脚下，悬停可看名称；动作和其他按钮收在「互动」里</p>
      </div>

      <h2 className="settings-group-title">显示</h2>
      <div className="settings-group">
        <div className="settings-row"><div className="settings-row__body"><strong>快捷按钮停留</strong><span>鼠标移开后，按钮多久变淡；所有角色共用</span></div><div className="segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="快捷按钮停留时间">{LINGER_OPTIONS.map((option) => <button key={option.value} type="button" role="radio" aria-checked={controlsLingerMs === option.value} className={controlsLingerMs === option.value ? "is-selected" : ""} onClick={() => onControlsLingerChange(option.value)}>{option.label}</button>)}</div></div>
      </div>

      <h2 className="settings-group-title">按钮</h2>
      <ul className={dragging ? "settings-group dock-list is-dragging" : "settings-group dock-list"}>
        {items.map((item, index) => {
          const key = keyOf(item);
          const label = labelOf(item);
          const open = expanded === key;
          return (
            <li key={key} ref={(node) => { if (node) rows.current.set(key, node); else rows.current.delete(key); }} className={`dock-row${dragging === key ? " is-dragging" : ""}${open ? " is-open" : ""}${item.enabled ? "" : " is-off"}`}>
              <div className="dock-row__line">
                <span className="dock-row__handle" role="button" tabIndex={0} aria-label={`拖动或用上下方向键调整“${label}”的位置`} title="拖动排序"
                  onPointerDown={(event) => startDrag(event, key)} onPointerMove={dragMove} onPointerUp={endDrag} onPointerCancel={endDrag} onKeyDown={(event) => handleKeys(event, index)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14M5 15h14" /></svg>
                </span>
                <span className="settings-icon-tile dock-row__face">
                  <DockButtonFace item={item} packId={packId} actions={actions} resolveAsset={resolveAsset} />
                </span>
                {item.kind === "control" ? (
                  <button type="button" className="dock-row__body" aria-expanded={open} onClick={() => setExpanded(open ? null : key)}>
                    <strong>{label}</strong>
                    <small>{DESCRIPTIONS[item.command]}</small>
                    <svg className="dock-row__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                  </button>
                ) : (
                  <span className="dock-row__body">
                    <strong>{label}</strong>
                    <small>{actionOf(item.id)?.description ?? "让宠物播放这个动作"}</small>
                  </span>
                )}
                {item.kind === "action" && (
                  <button type="button" className="dock-row__remove" aria-label={`从快捷按钮移除“${label}”`} title="从快捷按钮移除" onClick={() => commit(items.filter((entry) => keyOf(entry) !== key))}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12h10" /></svg>
                  </button>
                )}
                <button type="button" role="switch" aria-checked={item.enabled} aria-label={`显示“${label}”按钮`} className={item.enabled ? "toggle is-on" : "toggle"} onClick={() => toggle(key)}><span /></button>
              </div>
              {open && item.kind === "control" && editor(item)}
            </li>
          );
        })}
        <li className="dock-row dock-row--add">
          <button type="button" className="dock-add" aria-expanded={adding} disabled={addable.length === 0} onClick={() => setAdding((value) => !value)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v12M6 12h12" /></svg>
            {addable.length === 0 ? "所有可手动播放的动作都已经加上了" : "添加动作…"}
          </button>
          {adding && addable.length > 0 && (
            <div className="dock-add__choices" role="group" aria-label="可以添加的动作">
              {addable.map((action) => (
                <button key={action.id} type="button" className="dock-add__choice" title={action.description ?? undefined} onClick={() => { commit(setDockAction(items, action.id, true)); if (addable.length === 1) setAdding(false); }}>
                  <span className="dock-add__face" aria-hidden="true"><DockButtonFace item={{ kind: "action", id: action.id, enabled: true }} packId={packId} actions={actions} resolveAsset={resolveAsset} /></span>
                  <span className="dock-add__label">{action.label ?? action.id}</span>
                </button>
              ))}
            </div>
          )}
        </li>
      </ul>
      <p className="settings-footnote">拖动排序，点名称可以改名、换图标</p>

      <div className="settings-actions">
        <ConfirmButton className="settings-button" confirm={{ message: "恢复默认快捷按钮？", detail: "调整过的按钮、顺序、名字和图标都会改回这个角色原来的样子。", action: "恢复默认" }} onConfirm={restoreDefaults}>恢复默认快捷按钮</ConfirmButton>
      </div>
    </div>
  );
}
