import { useEffect, useMemo, useRef, useState } from "react";
import "./ActionLibrary.css";
import { loadAppearance, type ActionAppearance, type AppearanceLayer } from "../../../appearance/AppearanceStore";
import { ActionThumbnail } from "./ActionThumbnail";
import { ActionEditor, VisualPreview } from "./ActionEditor";
import { CopyButton } from "./CopyButton";
import { PromptField } from "./PromptField";
import { draftUserAction, isUserAction, USER_ACTION_LIMITS } from "../../../actions/UserActions";
import { BASE_ACTION } from "../../../appearance/looks";
import { ACTION_SLOT, DEFAULT_ART_PROMPTS, fillArtPrompt, usableArtPrompts, type ArtPrompts } from "../../../assets/ArtPrompt";
import type { AnimationEntry, PetControl } from "../../../assets/Manifest";
import type { ActionScene, ActionTier } from "../../../types";
import { petWindow } from "../../../platform/petWindow";
import { canShortcut, loadDisabledIdleActions, saveDisabledIdleActions } from "../../../preferences/ActionPreferences";
import { loadArtPrompts, saveArtPrompts } from "../../../preferences/ArtPromptPreferences";
import { dockControls, loadDock, saveDock, setDockAction, subscribeDock } from "../../../preferences/DockPreferences";
import { loadActionTriggerStats, subscribeActionTriggerStats } from "../../../preferences/ActionTriggerStats";

const DRAW_GROUPS: { title: string; note: string; tiers: (ActionTier | undefined)[] }[] = [
  { title: "先画这几张", note: "先确定待机形象，再补常用动作。", tiers: ["required", "core"] },
  { title: "日常", note: "陪伴、触摸和休息时会用到。", tiers: ["standard"] },
  { title: "聊天和提醒", note: "跟着聊天、备忘和提醒变化。", tiers: ["interactive"] },
  { title: "有空再画", note: "喂食和木鱼等互动动作。", tiers: ["fun"] },
  { title: "其他", note: "角色自带的额外动作。", tiers: [undefined] },
];

const SCENE_GROUPS: { scene: ActionScene | undefined; title: string; note: string; icon: string }[] = [
  { scene: "companion", title: "平时陪着你", note: "宠物空闲时自己的小动作。", icon: "M19.5 14.2A7.6 7.6 0 1 1 9.8 4.5a6 6 0 0 0 9.7 9.7z" },
  { scene: "touch", title: "你碰它的时候", note: "点击、摸摸头或拖动时。", icon: "M12 19.5s-7-4.3-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.3-7 9.6-7 9.6z" },
  { scene: "chat", title: "聊天的时候", note: "等回复时思考，回复失败时困惑。", icon: "M5.5 5h13A1.5 1.5 0 0 1 20 6.5v8a1.5 1.5 0 0 1-1.5 1.5H11l-4 3.2V16H5.5A1.5 1.5 0 0 1 4 14.5v-8A1.5 1.5 0 0 1 5.5 5z" },
  { scene: "tasks", title: "帮你做事的时候", note: "提醒、备忘和专注计时。", icon: "M6.5 16v-4.8a5.5 5.5 0 0 1 11 0V16l1.5 2H5zM10 20.2a2.1 2.1 0 0 0 4 0" },
  { scene: "play", title: "小玩法", note: "喂食和敲木鱼等互动。", icon: "M12 4l2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 15.8l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z" },
  { scene: undefined, title: "其他", note: "这个角色自带的其他动作。", icon: "M6 6h12v12H6zM12 9.5v5M9.5 12h5" },
];

const MINE_ICON = "M5 6.5h14v11H5zM12 9.5v5M9.5 12h5";
const PREVIEW_SIZE = { width: 340, height: 284 };

type SceneFilter = "all" | ActionScene | "other" | "mine";
type AssetFilter = "all" | "changed" | "borrowed" | "missing";

interface Props {
  actions: AnimationEntry[];
  controls: PetControl[];
  packId: string;
  custom: boolean;
  characterName: string;
  canvas: { width: number; height: number };
  resolveAsset: (file: string) => string;
  onActionsChanged: () => void;
  onPicturesChanged: () => void;
}

interface PreviewArt {
  image: string;
  frames: number;
  fps: number;
  motion: AnimationEntry["motion"];
  loop: boolean;
  speed: number;
  strength: number;
  randomFlip: boolean;
  layers: AppearanceLayer[];
}

function icon(path: string) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>;
}

export function ActionLibrary({ actions, controls, packId, custom: isCustomPack, characterName, canvas, resolveAsset, onActionsChanged, onPicturesChanged }: Props) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadAction = useRef<AnimationEntry | null>(null);
  const [initialFile, setInitialFile] = useState<File | undefined>();
  const [editing, setEditing] = useState<AnimationEntry | null>(null);
  const [revision, setRevision] = useState(0);
  const [appearances, setAppearances] = useState<Record<string, ActionAppearance> | null>(null);
  const [inDock, setInDock] = useState(() => loadDock(packId, dockControls(controls), actions).filter((item) => item.kind === "action" && item.enabled).map((item) => item.id));
  const [disabledIdle, setDisabledIdle] = useState(() => loadDisabledIdleActions(packId));
  const [triggerStats, setTriggerStats] = useState(() => loadActionTriggerStats(packId));
  const [message, setMessage] = useState("");
  const [prompts, setPrompts] = useState(() => loadArtPrompts(packId));
  const [search, setSearch] = useState("");
  const [sceneFilter, setSceneFilter] = useState<SceneFilter>("all");
  const [assetFilter, setAssetFilter] = useState<AssetFilter>("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const reload = () => setInDock(loadDock(packId, dockControls(controls), actions).filter((item) => item.kind === "action" && item.enabled).map((item) => item.id));
    return subscribeDock(packId, reload);
  }, [packId, controls, actions]);

  useEffect(() => {
    const reload = () => setTriggerStats(loadActionTriggerStats(packId));
    reload();
    return subscribeActionTriggerStats(packId, reload);
  }, [packId]);

  useEffect(() => {
    let active = true;
    Promise.all(actions.map(async (action) => [action.id, await loadAppearance(packId, action.id)] as const)).then((records) => {
      if (active) setAppearances(Object.fromEntries(records.filter((entry) => entry[1] !== null)) as Record<string, ActionAppearance>);
    }).catch((error) => {
      console.error("Could not read the custom pictures", error);
      if (active) { setAppearances({}); setMessage("动作图片没能读出来，关掉设置窗口再打开试试。"); }
    });
    return () => { active = false; };
  }, [actions, packId, revision]);

  const userActions = actions.filter(isUserAction);
  const draft = draftUserAction(actions);
  const canCreate = draft !== null && userActions.length < USER_ACTION_LIMITS.count;
  const drawGroups = DRAW_GROUPS.map((group) => ({ ...group, items: actions.filter((action) => !isUserAction(action) && group.tiers.includes(action.tier)) })).filter((group) => group.items.length > 0);
  const toDraw = drawGroups.flatMap((group) => group.items);
  const drawn = toDraw.filter((action) => appearances?.[action.id]).length;
  const base = toDraw.find((action) => action.id === BASE_ACTION);
  const baseDrawn = Boolean(appearances?.[BASE_ACTION]);
  const customImageCount = actions.filter((action) => appearances?.[action.id]).length;
  const borrowedCount = isCustomPack ? 0 : actions.filter((action) => !isUserAction(action) && action.borrowedFrom).length;
  const missingCount = isCustomPack ? toDraw.filter((action) => !appearances?.[action.id]).length : 0;
  const usablePrompts = usableArtPrompts(prompts);

  const promptFor = (action: AnimationEntry) => fillArtPrompt(isCustomPack && action.id === BASE_ACTION ? usablePrompts.first : usablePrompts.action, action);
  const copyPromptFor = (action: AnimationEntry) => isUserAction(action) ? usablePrompts.action : promptFor(action);
  const appearanceFor = (action: AnimationEntry) => appearances?.[action.id] ?? null;
  const artFor = (action: AnimationEntry): PreviewArt | null => {
    const saved = appearanceFor(action);
    if (saved) {
      return {
        image: saved.image,
        frames: saved.frames,
        fps: saved.fps,
        motion: saved.motion,
        loop: saved.loop,
        speed: saved.motionSpeed,
        strength: saved.motionStrength,
        randomFlip: saved.randomFlip ?? action.randomFlip,
        layers: saved.layers ?? [],
      };
    }
    if (isCustomPack || isUserAction(action)) return null;
    return {
      image: resolveAsset(action.file),
      frames: action.frames,
      fps: action.fps,
      motion: action.motion,
      loop: action.loop,
      speed: 1,
      strength: 1,
      randomFlip: action.randomFlip,
      layers: action.layers.map(({ file, ...layer }) => ({ source: { file }, ...layer })),
    };
  };

  const toggleDock = (id: string) => {
    try {
      const next = setDockAction(loadDock(packId, dockControls(controls), actions), id, !inDock.includes(id));
      saveDock(packId, next);
      setInDock(next.filter((item) => item.kind === "action" && item.enabled).map((item) => item.id));
      setMessage("");
    } catch (error) {
      console.error("Could not save the action setting", error);
      setMessage("没能保存快捷按钮设置，请再试一次。");
    }
  };

  const toggleIdle = (id: string) => {
    const next = disabledIdle.includes(id) ? disabledIdle.filter((item) => item !== id) : [...disabledIdle, id];
    try {
      saveDisabledIdleActions(packId, next);
      setDisabledIdle(next);
      setMessage("");
    } catch (error) {
      console.error("Could not save the action setting", error);
      setMessage("没能保存自动播放设置，请再试一次。");
    }
  };

  const changePrompt = (which: keyof ArtPrompts, text: string) => {
    const next = { ...prompts, [which]: text };
    setPrompts(next);
    try {
      saveArtPrompts(packId, next);
      setMessage("");
    } catch (error) {
      console.error("Could not save the art prompt", error);
      setMessage("提示词没能保存，请再试一次。");
    }
  };

  const openPreview = (action: AnimationEntry, source: HTMLElement) => {
    returnFocusRef.current = source;
    setPreviewId(action.id);
    setMessage("");
  };

  const closePreview = (restoreFocus = true) => {
    setPreviewId(null);
    if (restoreFocus) requestAnimationFrame(() => returnFocusRef.current?.focus());
  };

  const visibleActions = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return actions.filter((action) => {
      if (sceneFilter === "mine" && !isUserAction(action)) return false;
      if (sceneFilter === "other" && (isUserAction(action) || action.scene !== undefined)) return false;
      if (sceneFilter !== "all" && sceneFilter !== "mine" && sceneFilter !== "other" && (isUserAction(action) || action.scene !== sceneFilter)) return false;
      const saved = Boolean(appearances?.[action.id]);
      if (assetFilter === "changed" && !saved) return false;
      if (assetFilter === "borrowed" && (isCustomPack || isUserAction(action) || !action.borrowedFrom)) return false;
      if (assetFilter === "missing" && (!isCustomPack || saved || isUserAction(action))) return false;
      if (!query) return true;
      return [action.label, action.id, action.description, action.pose].some((value) => value?.toLocaleLowerCase().includes(query));
    });
  }, [actions, appearances, assetFilter, isCustomPack, sceneFilter, search]);

  const previewIndex = previewId ? visibleActions.findIndex((action) => action.id === previewId) : -1;
  const previewAction = previewIndex >= 0 ? visibleActions[previewIndex] : null;
  const previewArt = previewAction ? artFor(previewAction) : null;
  const previewName = previewAction ? (previewAction.label ?? previewAction.id) : "";

  const movePreview = (offset: -1 | 1) => {
    const next = visibleActions[previewIndex + offset];
    if (next) { setPreviewId(next.id); setMessage(""); }
  };

  useEffect(() => {
    if (!previewAction) return;
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closePreview(); }
      if (event.key === "ArrowLeft" && previewIndex > 0) { event.preventDefault(); movePreview(-1); }
      if (event.key === "ArrowRight" && previewIndex < visibleActions.length - 1) { event.preventDefault(); movePreview(1); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewAction, previewIndex, visibleActions]);

  const uploadDirect = (action: AnimationEntry) => { uploadAction.current = action; uploadRef.current?.click(); };

  const openEditor = (action: AnimationEntry) => {
    setInitialFile(undefined);
    setPreviewId(null);
    setEditing(action);
    setMessage("");
  };

  const closeEditor = () => {
    const created = editing?.id === "";
    setEditing(null);
    setInitialFile(undefined);
    if (created) requestAnimationFrame(() => document.querySelector(".action-library__group--mine")?.scrollIntoView({ block: "start" }));
  };

  const play = async (action: AnimationEntry) => {
    try {
      await petWindow.requestAction(action.id);
      setMessage("");
    } catch (error) {
      console.error("Could not play the action", error);
      setMessage(petWindow.isNative ? "宠物没有回应，可能还没准备好，稍等一下再试。" : "请在桌面应用中预览动作。");
    }
  };

  if (editing) {
    const idleArt = artFor(base ?? editing);
    const reference = idleArt ? { image: idleArt.image, frames: idleArt.frames } : undefined;
    return <ActionEditor initialFile={initialFile} key={editing.id || "new"} action={editing} packId={packId} blank={isCustomPack && !isUserAction(editing)} prompt={isUserAction(editing) ? usablePrompts.action : promptFor(editing)} reference={reference} canvas={canvas} resolveAsset={resolveAsset} onClose={closeEditor} onSaved={() => { setRevision((value) => value + 1); onPicturesChanged(); if (isUserAction(editing)) onActionsChanged(); }} />;
  }

  // The user's own actions come first: they are what the user is most likely to come back for.
  const descriptors = [
    { key: "mine" as const, title: "我的动作", note: "自己创建的动作。", icon: MINE_ICON, scene: undefined },
    ...SCENE_GROUPS.map((group) => ({ key: group.scene ?? "other", title: group.title, note: group.note, icon: group.icon, scene: group.scene })),
  ];
  const categoryCount = (key: SceneFilter) => actions.filter((action) => {
    if (key === "all") return true;
    if (key === "mine") return isUserAction(action);
    if (key === "other") return !isUserAction(action) && action.scene === undefined;
    return !isUserAction(action) && action.scene === key;
  }).length;
  const selectedDescriptor = descriptors.find((group) => group.key === sceneFilter);
  const groupsToRender = (sceneFilter === "all" ? descriptors : selectedDescriptor ? [selectedDescriptor] : []).map((group) => ({
    ...group,
    items: visibleActions.filter((action) => group.key === "mine"
      ? isUserAction(action)
      : !isUserAction(action) && (group.scene === undefined ? action.scene === undefined : action.scene === group.scene)),
  })).filter((group) => group.items.length > 0 || (group.key === "mine" && userActions.length === 0 && !search && assetFilter === "all"));

  const filterOptions: { key: AssetFilter; label: string; count: number }[] = [
    { key: "all", label: "全部", count: actions.length },
    { key: "changed", label: "已换图", count: customImageCount },
    ...(borrowedCount > 0 ? [{ key: "borrowed" as const, label: "沿用图片", count: borrowedCount }] : []),
    ...(missingCount > 0 ? [{ key: "missing" as const, label: "待补图片", count: missingCount }] : []),
  ];

  const statusOf = (action: AnimationEntry) => {
    if (appearanceFor(action)) return { className: "is-changed", label: "已换图" };
    if (isCustomPack || isUserAction(action)) return { className: "is-missing", label: "待补图片" };
    if (action.borrowedFrom) {
      const lender = actions.find((item) => item.id === action.borrowedFrom);
      return { className: "is-borrowed", label: `沿用${lender?.label ?? "其他动作"}` };
    }
    // The character's own picture is the usual case and needs no label.
    return null;
  };
  const previewStatus = previewAction && statusOf(previewAction);

  const renderCard = (action: AnimationEntry) => {
    const art = artFor(action);
    const status = statusOf(action);
    const name = action.label ?? action.id;
    const pending = !art;
    return <article className={`action-tile${pending ? " is-empty" : ""}`} key={action.id}>
      <button type="button" className="action-tile__art" onClick={(event) => openPreview(action, event.currentTarget)} aria-label={`预览${name}图片`}>
        {art
          ? <ActionThumbnail src={art.image} frames={art.frames} label={name} />
          : <span className="action-tile__empty"><span aria-hidden="true">＋</span><small>还没有专属图片</small></span>}
        {art && <span className="action-tile__zoom" aria-hidden="true">放大</span>}
      </button>
      <div className="action-tile__body">
        <div className="action-tile__title-row">
          <strong title={name}>{name}</strong>
          {status && <span className={`action-tile__status ${status.className}`} title={status.label}>{status.label}</span>}
        </div>
        <p title={action.description ?? action.pose ?? ""}>{action.description ?? action.pose ?? (isUserAction(action) ? "自定义动作" : "角色动作")}</p>
        <div className="action-tile__tools">
          {/* Prompts help only while a picture is still to be drawn; a drawn one offers them in its preview and editor. */}
          {pending && <CopyButton className="action-tile__link" text={copyPromptFor(action)} onMessage={setMessage}>{isUserAction(action) ? "复制模板" : "复制提示词"}</CopyButton>}
          {!pending && <button type="button" className="action-tile__link" onClick={(event) => openPreview(action, event.currentTarget)}>预览</button>}
          <button type="button" className={pending ? "action-tile__button is-primary" : "action-tile__button"} onClick={() => pending ? uploadDirect(action) : openEditor(action)}>{pending ? "上传图片" : "编辑"}</button>
        </div>
      </div>
    </article>;
  };

  return <div className="settings-section action-library">
    <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file && uploadAction.current) { setInitialFile(file); setPreviewId(null); setEditing(uploadAction.current); } }} />
    {message && <p className="settings-error" role="status">{message}</p>}

    {isCustomPack && <section className="action-progress" aria-label="角色动作素材进度">
      <div className="action-progress__copy"><strong>{baseDrawn ? `${characterName}的动作素材` : `先为${characterName}定下样子`}</strong><span>{baseDrawn ? `已准备 ${drawn} / ${toDraw.length} 张专属图片` : "第一张待机图会确定角色的整体形象"}</span></div>
      <div className="action-progress__number"><strong>{drawn}</strong><span> / {toDraw.length}</span></div>
      <div className="action-progress__track" role="progressbar" aria-label="已准备的专属动作图片" aria-valuemin={0} aria-valuemax={toDraw.length} aria-valuenow={drawn}><span style={{ width: `${toDraw.length ? (drawn / toDraw.length) * 100 : 0}%` }} /></div>
    </section>}

    <div className="action-library__toolbar">
      <label className="action-library__search">
        {icon("M10.8 4.5a6.3 6.3 0 1 0 0 12.6 6.3 6.3 0 0 0 0-12.6ZM15.4 15.4 20 20")}
        <input type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="搜索动作名称或说明" aria-label="搜索动作名称或说明" />
        {search && <button type="button" aria-label="清除搜索" onClick={() => setSearch("")}>×</button>}
      </label>
      {canCreate && <button type="button" className="action-library__create" onClick={() => setEditing(draft)}>{icon("M12 5v14M5 12h14")}新建动作</button>}
    </div>

    <div className="action-library__filters" role="group" aria-label="按图片状态筛选">
      {filterOptions.map((option) => <button key={option.key} type="button" aria-pressed={assetFilter === option.key} className={assetFilter === option.key ? "is-selected" : ""} onClick={() => setAssetFilter(option.key)}>
        {option.label}<span>{option.count}</span>
      </button>)}
    </div>

    <nav className="action-library__categories" aria-label="按动作场景筛选">
      <button type="button" aria-pressed={sceneFilter === "all"} className={sceneFilter === "all" ? "is-selected" : ""} onClick={() => setSceneFilter("all")}>所有场景</button>
      {descriptors.filter((group) => categoryCount(group.key as SceneFilter) > 0).map((group) => <button key={group.key} type="button" aria-pressed={sceneFilter === group.key} className={sceneFilter === group.key ? "is-selected" : ""} onClick={() => setSceneFilter(group.key as SceneFilter)}>{group.title}<span>{categoryCount(group.key as SceneFilter)}</span></button>)}
    </nav>
    {!isCustomPack && <details className="action-guide">
      <summary><span>用 AI 画动作图</span><small>复制提示词模板，交给绘图工具</small></summary>
      <div className="action-guide__single">
        <p>重画动作时，在编辑页复制该动作的提示词；绘制清单外的动作时，复制模板并替换里面的 {ACTION_SLOT}。</p>
        <PromptField copyLabel="复制动作提示词模板" copyText={usablePrompts.action} summary="查看和修改模板" value={prompts.action} fallback={DEFAULT_ART_PROMPTS.action} note="改过的模板只对当前角色生效。" onChange={(text) => changePrompt("action", text)} onMessage={setMessage} />
      </div>
    </details>}

    {isCustomPack && <details className="action-guide" open={guideOpen} onToggle={(event) => setGuideOpen(event.currentTarget.open)}>
      <summary><span>素材制作说明</span><small>{baseDrawn ? "可以逐张补动作，也可以修改提示词" : "先上传待机图，再补其他动作"}</small></summary>
      <div className="action-guide__content">
        <div className="action-guide__step"><strong>先画待机图</strong><p>把角色参考图和提示词一起交给绘图工具，确定整体形象后上传到「安静陪伴」。</p>
          <PromptField copyLabel="复制待机图提示词" copyText={base ? promptFor(base) : usablePrompts.first} summary="查看和修改" value={prompts.first} fallback={DEFAULT_ART_PROMPTS.first} note="画风可以在【画风】一行里调整。" primary={!baseDrawn} onChange={(text) => changePrompt("first", text)} onMessage={setMessage} />
        </div>
        <div className="action-guide__step"><strong>再补其他动作</strong><p>点每张待补图片的「复制提示词」，并附上待机图作为角色参考。敲木鱼的六宫格可以直接导入，按行列拆分。</p>
          <PromptField copyLabel="复制动作提示词模板" copyText={usablePrompts.action} summary="查看和修改模板" value={prompts.action} fallback={DEFAULT_ART_PROMPTS.action} note={`动作说明会替换模板里的 ${ACTION_SLOT}。`} onChange={(text) => changePrompt("action", text)} onMessage={setMessage} />
        </div>
      </div>
    </details>}

    {groupsToRender.length > 0 ? groupsToRender.map((group) => <section className={`action-library__group${group.key === "mine" ? " action-library__group--mine" : ""}`} key={group.key}>
      <header className="action-library__group-head">
        <span className={`action-library__group-icon action-library__group-icon--${group.key}`} aria-hidden="true">{icon(group.icon)}</span>
        <div><h2>{group.title}</h2><p>{group.note}</p></div>
        <span className="action-library__group-count">{group.items.length}</span>
        {group.key === "mine" && canCreate && <button type="button" className="action-library__new-link" onClick={() => setEditing(draft)}>＋ 新建</button>}
      </header>
      {group.key === "mine" && group.items.length === 0
        ? <p className="action-library__empty-mine">还没有自己的动作。选一张图片，配上摇摆或跳跃动效，点右上角「新建动作」就能做出专属动作。</p>
        : <div className="action-library__grid">{group.items.map(renderCard)}</div>}
    </section>) : <div className="action-library__empty-search"><span aria-hidden="true">⌕</span><strong>没有找到动作</strong><p>换个名称，或清除筛选条件。</p><button type="button" onClick={() => { setSearch(""); setAssetFilter("all"); setSceneFilter("all"); }}>清除筛选</button></div>}

    {previewAction && (
      <div className="action-preview" onMouseDown={(event) => { if (event.target === event.currentTarget) closePreview(); }}>
        <section className="action-preview__dialog" role="dialog" aria-modal="true" aria-labelledby="action-preview-title" tabIndex={-1} ref={dialogRef}>
          <header className="action-preview__header">
            <div><span className="action-preview__eyebrow">动作预览</span><h2 id="action-preview-title">{previewName}</h2></div>
            <button type="button" className="action-preview__close" aria-label="关闭预览" onClick={() => closePreview()}>{icon("M6 6l12 12M18 6 6 18")}</button>
          </header>
          <div className="action-preview__content">
            <div className="action-preview__stage" aria-label={`${previewName}的图片预览`}>
              {previewArt
                ? <VisualPreview key={previewAction.id} image={previewArt.image} frames={previewArt.frames} fps={previewArt.fps} motion={previewArt.motion} loop={previewArt.loop} speed={previewArt.speed} strength={previewArt.strength} duration={previewAction.duration} layers={previewArt.layers} stage={canvas} align={previewAction.align} randomFlip={previewArt.randomFlip} resolveAsset={resolveAsset} size={PREVIEW_SIZE} />
                : <button type="button" className="action-preview__missing" onClick={() => uploadDirect(previewAction)}><span aria-hidden="true">＋</span><strong>添加动作图片</strong><p>{previewAction.pose ?? previewAction.description ?? "选择图片后调整位置。"}</p></button>}
            </div>
            <aside className="action-preview__details">
              {previewStatus && <span className={`action-tile__status ${previewStatus.className}`}>{previewStatus.label}</span>}
              <p>{previewAction.description ?? previewAction.pose ?? "角色动作"}</p>
              <span className="action-preview__meta">实际播放 {triggerStats[previewAction.id] ?? 0} 次 · 手动预览也算</span>
              {previewArt && previewArt.frames > 1 && <span className="action-preview__meta">{previewArt.frames} 帧 · {previewArt.fps} 帧 / 秒</span>}
              {previewAction.duration && <span className="action-preview__meta">播放时长 {`${(previewAction.duration / 1000).toFixed(1)} 秒`}</span>}
              {previewArt?.randomFlip && <span className="action-preview__meta">每次随机朝左或朝右，一张图镜像出两个方向；可在编辑图片里关掉</span>}
              <CopyButton className="action-library__button action-library__button--quiet" text={copyPromptFor(previewAction)} onMessage={setMessage}>{isUserAction(previewAction) ? "复制提示词模板" : "复制这张图的提示词"}</CopyButton>
              {message && <p className="action-preview__message" role="status">{message}</p>}
            </aside>
          </div>
          <div className="action-preview__navigation">
            <button type="button" className="action-preview__step" disabled={previewIndex <= 0} onClick={() => movePreview(-1)} aria-label="上一个动作">‹</button>
            <span>{previewIndex + 1} / {visibleActions.length}<small>方向键切换</small></span>
            <button type="button" className="action-preview__step" disabled={previewIndex >= visibleActions.length - 1} onClick={() => movePreview(1)} aria-label="下一个动作">›</button>
            <div className="action-preview__actions">
              {canShortcut(previewAction) && <>
                <button type="button" className={inDock.includes(previewAction.id) ? "action-preview__secondary is-selected" : "action-preview__secondary"} aria-pressed={inDock.includes(previewAction.id)} onClick={() => toggleDock(previewAction.id)}>{inDock.includes(previewAction.id) ? "已加入快捷按钮" : "加入快捷按钮"}</button>
                {previewAction.category === "idle" && <button type="button" className={disabledIdle.includes(previewAction.id) ? "action-preview__secondary" : "action-preview__secondary is-selected"} role="switch" aria-label="空闲时自动播放" aria-checked={!disabledIdle.includes(previewAction.id)} onClick={() => toggleIdle(previewAction.id)}>{disabledIdle.includes(previewAction.id) ? "空闲时播放：关闭" : "空闲时播放：开启"}</button>}
                <button type="button" className="action-preview__secondary" title="在桌面宠物上播放这个动作" onClick={() => void play(previewAction)}>在桌面播放</button>
              </>}
              <button type="button" className="action-library__button" onClick={() => previewArt ? openEditor(previewAction) : uploadDirect(previewAction)}>{previewArt ? "编辑图片" : "上传图片"}</button>
            </div>
          </div>
        </section>
      </div>
    )}
  </div>;
}
