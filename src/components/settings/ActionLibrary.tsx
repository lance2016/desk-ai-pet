import { useEffect, useState } from "react";
import { loadAppearance, type ActionAppearance } from "../../appearance/AppearanceStore";
import { ActionThumbnail } from "./ActionThumbnail";
import { ActionEditor } from "./ActionEditor";
import { draftUserAction, isUserAction, USER_ACTION_LIMITS } from "../../actions/UserActions";
import { buildArtPrompt } from "../../assets/ArtPrompt";
import type { AnimationEntry, PetControl } from "../../assets/Manifest";
import { petWindow } from "../../platform/petWindow";
import { canShortcut, loadDisabledIdleActions, saveDisabledIdleActions } from "../../preferences/ActionPreferences";
import { dockControls, loadDock, saveDock, setDockAction, subscribeDock } from "../../preferences/DockPreferences";

/** How long the copy button says it copied. */
const COPIED_HINT_MS = 1_600;

interface Props {
  actions: AnimationEntry[];
  /** The character's own dock buttons, needed to read and save the dock. */
  controls: PetControl[];
  packId: string;
  /** A character the user made: it borrows another character's pictures until each is replaced. */
  custom: boolean;
  /** Shown in the drawing guide. */
  characterName: string;
  canvas: { width: number; height: number };
  resolveAsset: (file: string) => string;
  /** The user made, changed or deleted one of their own actions. */
  onActionsChanged: () => void;
  /** Any action got or lost a picture of its own: portraits elsewhere may change. */
  onPicturesChanged: () => void;
}

export function ActionLibrary({ actions, controls, packId, custom: isCustomPack, characterName, canvas, resolveAsset, onActionsChanged, onPicturesChanged }: Props) {
  const [editing, setEditing] = useState<AnimationEntry | null>(null);
  const [revision, setRevision] = useState(0);
  /** Null until read: a custom character's page depends on which pictures are replaced. */
  const [appearances, setAppearances] = useState<Record<string, ActionAppearance> | null>(null);
  const loadShown = () => loadDock(packId, dockControls(controls), actions).filter((item) => item.kind === "action" && item.enabled).map((item) => item.id);
  const [inDock, setInDock] = useState(loadShown);
  const [disabledIdle, setDisabledIdle] = useState(() => loadDisabledIdleActions(packId));
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => subscribeDock(packId, () => setInDock(loadDock(packId, dockControls(controls), actions).filter((item) => item.kind === "action" && item.enabled).map((item) => item.id))), [packId, controls, actions]);

  useEffect(() => {
    let active = true;
    Promise.all(actions.map(async (action) => [action.id, await loadAppearance(packId, action.id)] as const)).then((records) => {
      if (active) setAppearances(Object.fromEntries(records.filter((entry) => entry[1] !== null)) as Record<string, ActionAppearance>);
    }).catch((error) => { console.error("Could not read the custom pictures", error); if (active) { setAppearances({}); setMessage("自己换过的动作图片没能读出来，关掉设置窗口再打开试试。"); } });
    return () => { active = false; };
  }, [actions, packId, revision]);

  /** The same switch as the action's row on the 快捷按钮 page: hiding keeps its place there. */
  const toggleDock = (id: string) => {
    try {
      saveDock(packId, setDockAction(loadDock(packId, dockControls(controls), actions), id, !inDock.includes(id)));
      setInDock(loadShown());
      setMessage("");
    } catch (error) {
      console.error("Could not save the action setting", error);
      setMessage("没能保存，请再试一次。");
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
      setMessage("没能保存，请再试一次。");
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildArtPrompt(actions));
      setCopied(true);
      setMessage("");
      window.setTimeout(() => setCopied(false), COPIED_HINT_MS);
    } catch (error) {
      console.error("Failed to copy the art prompt", error);
      setMessage("没能复制到剪贴板，请再试一次。");
    }
  };

  const preview = async (action: AnimationEntry) => {
    try {
      await petWindow.requestAction(action.id);
      setMessage("");
    } catch (error) {
      console.error("Could not play the action", error);
      setMessage(petWindow.isNative ? "宠物没有回应，可能还没准备好，稍等一下再点「播放」。" : "请在桌面应用中预览动作。");
    }
  };

  const closeEditor = () => {
    const created = editing?.id === "";
    setEditing(null);
    // A new action sits in the first group; show it.
    if (created) requestAnimationFrame(() => document.querySelector(".settings-content")?.scrollTo({ top: 0 }));
  };

  if (editing) return <ActionEditor key={editing.id || "new"} action={editing} packId={packId} blank={isCustomPack && !isUserAction(editing)} canvas={canvas} resolveAsset={resolveAsset} onClose={closeEditor} onSaved={() => { setRevision((value) => value + 1); onPicturesChanged(); if (isUserAction(editing)) onActionsChanged(); }} />;

  const userActions = actions.filter(isUserAction);
  const draft = draftUserAction(actions);
  const canCreate = draft !== null && userActions.length < USER_ACTION_LIMITS.count;
  /** In the order and numbering of the art prompt. */
  const toDraw = actions.filter((action) => !isUserAction(action));
  const drawn = toDraw.filter((action) => appearances?.[action.id]).length;
  const drawing = isCustomPack && drawn < toDraw.length;

  /** A picture still to draw: only its number, name and what to draw, never the borrowed picture. */
  /** The next picture to draw gets the one coloured button. */
  const next = drawing ? toDraw.find((action) => !appearances?.[action.id]) : undefined;
  const todoRow = (action: AnimationEntry, step: number) => <li className="action-row is-todo" key={action.id}>
    <span className="action-row__step">{step}</span>
    <div className="action-row__art action-row__art--empty" aria-hidden="true" />
    <div className="action-row__detail">
      <strong>{action.label ?? action.id}</strong>
      <p title={action.pose}>{action.pose ?? action.description}</p>
    </div>
    <div className="action-row__tools">
      <button type="button" className={action === next ? "settings-button settings-button--small settings-button--primary" : "settings-button settings-button--small"} onClick={() => setEditing(action)}>上传图片</button>
    </div>
  </li>;

  const row = (action: AnimationEntry, step?: number) => {
    const allowed = canShortcut(action);
    const custom = appearances?.[action.id];
    if (drawing && step !== undefined && !custom) return todoRow(action, step);
    const name = action.label ?? action.id;
    const added = inDock.includes(action.id);
    const autoPlay = !disabledIdle.includes(action.id);
    return <li className="action-row" key={action.id}>
      {step !== undefined && <span className="action-row__step is-done" aria-label={`第 ${step} 张，已换好`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.5 3.5 7.5-8" /></svg></span>}
      <div className="action-row__art"><ActionThumbnail src={custom?.image ?? resolveAsset(action.file)} frames={custom?.frames ?? action.frames} label={name} /></div>
      <div className="action-row__detail">
        <strong>{name}{custom && !isUserAction(action) && !isCustomPack && <span className="action-row__custom">已自定义</span>}</strong>
        <p>{isUserAction(action) ? `播放 ${((action.duration ?? 0) / 1000).toFixed(1)} 秒` : action.description ?? (allowed ? "可手动播放" : "由宠物状态自动触发")}</p>
      </div>
      <div className="action-row__tools">
        {action.category === "idle" && <button type="button" className={autoPlay ? "action-row__auto is-on" : "action-row__auto"} role="switch" aria-checked={autoPlay} title="空闲时自动播放" onClick={() => toggleIdle(action.id)}><span aria-hidden="true" />自动</button>}
        {allowed && <button type="button" className="settings-button settings-button--small" onClick={() => void preview(action)} title="让桌面上的宠物做一次（睡着时会先醒过来；正在做别的动作时可能不播）">播放</button>}
        {allowed && (
          <button type="button" className={added ? "dock-chip is-on" : "dock-chip"} aria-pressed={added} onClick={() => toggleDock(action.id)} title={added ? "已经在宠物旁边的快捷按钮里，点一下拿掉" : "放到宠物旁边的快捷按钮里，随时点"}>
            <svg viewBox="0 0 24 24" aria-hidden="true">{added ? <path d="m6.5 12.5 3.5 3.5 7.5-8" /> : <path d="M12 6v12M6 12h12" />}</svg>
            快捷按钮
          </button>
        )}
        <button type="button" className="settings-button settings-button--small" onClick={() => setEditing(action)} title="换图片、调动效">编辑</button>
      </div>
    </li>;
  };

  const groups = [
    { title: "可以手动播放", note: "点亮「快捷按钮」的动作会出现在宠物旁边，在「快捷按钮」页可以排序。", items: actions.filter((action) => canShortcut(action) && action.category !== "idle" && !isUserAction(action)) },
    { title: "空闲小动作", note: "宠物闲着时随机播放，可以单独关掉。", items: actions.filter((action) => action.category === "idle") },
    { title: "状态动作", note: "睡觉、贴边、被拎起等，由宠物状态自动触发，只能换素材。", items: actions.filter((action) => !canShortcut(action) && action.category !== "idle") },
  ].filter((group) => group.items.length > 0);

  const myActions = <section className="action-group">
    <header>
      <h3>我的动作</h3><span>用自己的图片做的动作，可以播放、放进快捷按钮。</span>
      {canCreate && <button type="button" className="settings-button settings-button--small action-group__add" onClick={() => setEditing(draft)}>新建动作…</button>}
    </header>
    {userActions.length > 0
      ? <ul className="action-list">{userActions.map((action) => row(action))}</ul>
      : <div className="action-list action-empty">
        <p>还没有自己的动作。点右上角「新建动作…」，选一张图片配上跳跃、摇摆这类动效，或者上传一组逐帧图片，就能做一个。</p>
      </div>}
    {draft !== null && !canCreate && <p className="action-group__note">最多 {USER_ACTION_LIMITS.count} 个，删掉一个再新建。</p>}
  </section>;

  // Which pictures are replaced decides the page; wait for it rather than flash the wrong one.
  if (isCustomPack && appearances === null) return <div className="settings-section action-library" />;

  if (drawing) return <div className="settings-section action-library">
    {message && <p className="settings-error" role="status">{message}</p>}
    <section className="draw-guide">
      <div className="draw-guide__head">
        <div>
          <h3>给{characterName}画一套自己的样子</h3>
          <p>{characterName}现在借用着别的角色的图片。把下面 {toDraw.length} 个动作换成自己的图，桌面上的宠物就是{characterName}的样子了。没换的动作暂时还用借来的图。</p>
        </div>
        <p className="draw-guide__count"><span><strong>{drawn}</strong> / {toDraw.length}</span><small>已换好</small></p>
      </div>
      <div className="draw-guide__meter" role="progressbar" aria-label="已换好的动作" aria-valuemin={0} aria-valuemax={toDraw.length} aria-valuenow={drawn}><span style={{ width: `${(drawn / toDraw.length) * 100}%` }} /></div>
      <ol className="draw-guide__steps">
        <li><strong>准备一张参考图</strong><span>{characterName}的全身图，自己画的、AI 画的都可以。</span></li>
        <li>
          <strong>让 ChatGPT 照着画</strong><span>复制提示词，和参考图一起发给 ChatGPT，它会按下面的编号一张一张画。</span>
          <div className="draw-guide__prompt">
            <button type="button" className="settings-button settings-button--small settings-button--primary" onClick={() => void copyPrompt()}>{copied ? "已复制" : "复制提示词"}</button>
            <details><summary>看看提示词写了什么</summary><pre>{buildArtPrompt(actions)}</pre></details>
          </div>
        </li>
        <li><strong>画好一张，上传一张</strong><span>在下面对应编号那一行点「上传图片」。透明背景的图效果最好，四周的空白会自动裁掉。</span></li>
      </ol>
    </section>
    <section className="action-group">
      <header><h3>要画的动作</h3><span>编号和提示词里的一致。先画第 1 张，后面的都以它为准。</span></header>
      <ul className="action-list">{toDraw.map((action, index) => row(action, index + 1))}</ul>
    </section>
    {myActions}
  </div>;

  return <div className="settings-section action-library">
    {message && <p className="settings-error" role="status">{message}</p>}
    <section className="art-prompt">
      <div className="art-prompt__text">
        <strong>用 AI 画一套新形象</strong>
        <p>复制提示词，在 ChatGPT 里连同角色参考图一起发送，它会按下面的动作逐张画图。画好后在对应动作的「编辑」里选「单张图片」上传，四周的透明空白会自动裁掉。</p>
        <details><summary>查看提示词</summary><pre>{buildArtPrompt(actions)}</pre></details>
      </div>
      <button type="button" className="settings-button" onClick={() => void copyPrompt()}>{copied ? "已复制" : "复制提示词"}</button>
    </section>
    {myActions}
    {groups.map((group) => <section className="action-group" key={group.title}>
      <header><h3>{group.title}</h3><span>{group.note}</span></header>
      <ul className="action-list">{group.items.map((action) => row(action))}</ul>
    </section>)}
  </div>;
}
