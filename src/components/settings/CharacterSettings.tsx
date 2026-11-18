import { useState, type ChangeEvent, type FormEvent } from "react";
import { loadUserActions } from "../../actions/UserActions";
import { listAppearances, resetAppearance } from "../../appearance/AppearanceStore";
import type { AnimationEntry, PetPersona } from "../../assets/Manifest";
import { createCustomCharacter, DEFAULT_PACK_ID, deleteCustomCharacter, isCustomCharacter, type CatalogEntry } from "../../assets/PackCatalog";
import { clearCharacterData, saveActiveCharacter } from "../../preferences/CharacterPreferences";
import { loadChatAppearance, pictureFor } from "../../preferences/ChatAppearance";
import { characterName, chatDefaults, loadChatPreferences, saveChatPreferences, type ChatPreferences } from "../../preferences/ChatPreferences";
import { loadUserProfile, saveUserProfile, USER_PROFILE_LIMITS } from "../../preferences/UserProfile";
import { systemPlatform } from "../../platform/system";
import { characterPackageFileName, characterPackageText, createCharacterPackage, importCharacterPackage, MAX_CHARACTER_PACKAGE_BYTES, parseCharacterPackage, renameCharacterPackage, summarizeCharacterPackage, uniqueCharacterName, type CharacterPackage, type CharacterPackageSummary } from "../../storage/CharacterPackage";
import { PERSONA_LIMITS } from "../../types";
import { CharacterAvatar } from "../CharacterAvatar";
import { ConfirmButton } from "../ConfirmButton";
import { ChatLookSettings } from "./ChatLookSettings";

interface Props {
  packId: string;
  catalog: CatalogEntry[];
  persona?: PetPersona;
  /** Actions of the current character: picture choices, and what to clean up when it is deleted. */
  actions: AnimationEntry[];
  onCatalogChange: () => void;
}

const EMPTY_DRAFT = { name: "", personality: "", base: DEFAULT_PACK_ID };
/** Saving fails when local storage is full; the user can do something about that. */
const STORAGE_FULL = "没能保存：这台电脑上给 AI Pet 的存储空间满了。删掉几段旧聊天或几张自定义图片再试。";

/** Where each message shows: under the form it is about. */
type Area = "profile" | "list" | "create" | "current" | "transfer";

/** Pick, rename and create characters. Everything here belongs to one character at a time. */
export function CharacterSettings({ packId, catalog, persona, actions, onCatalogChange }: Props) {
  const defaults = chatDefaults(persona);
  const [preferences, setPreferences] = useState(() => loadChatPreferences(packId, persona));
  const [nickname, setNickname] = useState(() => loadUserProfile().nickname);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [message, setMessage] = useState<{ area: Area; text: string } | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ characterPackage: CharacterPackage; summary: CharacterPackageSummary; name: string } | null>(null);
  /** Bumped when the avatar changes, so the tiles read it again. */
  const [, setLookVersion] = useState(0);
  const looks = catalog.filter((entry) => !entry.custom);
  const current = catalog.find((entry) => entry.id === packId);
  const say = (area: Area, text: string) => setMessage({ area, text });
  const note = (area: Area) => message?.area === area && <p className="ai-settings__status" role="status">{message.text}</p>;

  const switchTo = (id: string) => {
    if (id === packId) return;
    try { saveActiveCharacter(id); } catch (reason) { console.error("Could not switch characters", reason); say("list", "没能切换角色，请再试一次。"); }
  };
  const update = (next: ChatPreferences) => {
    setPreferences(next);
    try { saveChatPreferences(packId, next); } catch (reason) { console.error("Could not save the character", reason); say("current", STORAGE_FULL); }
  };
  const create = (event: FormEvent) => {
    event.preventDefault();
    try {
      const character = createCustomCharacter({ base: draft.base, name: draft.name, personality: draft.personality });
      onCatalogChange();
      setCreating(false);
      setDraft(EMPTY_DRAFT);
      setMessage(null);
      saveActiveCharacter(character.id);
    } catch (reason) {
      console.error("Could not create the character", reason);
      const text = String(reason);
      say("create", text.includes("At most") ? "角色数量已经到上限了，先删掉一个不用的角色。" : text.includes("ZodError") || text.includes("name") ? `名字要 1 到 ${PERSONA_LIMITS.name} 个字。` : STORAGE_FULL);
    }
  };
  const remove = async () => {
    // Read before the character's data is cleared: its own actions are listed there, and their pictures live elsewhere.
    const pictures = [...actions.map((action) => action.id), ...loadUserActions(packId).map((action) => action.id)];
    try {
      saveActiveCharacter(DEFAULT_PACK_ID);
      deleteCustomCharacter(packId);
      clearCharacterData(packId);
      onCatalogChange();
    } catch (reason) { console.error("Could not delete the character", reason); say("current", "没能删除这个角色，请再试一次。"); return; }
    const results = await Promise.allSettled([...new Set(pictures)].map((id) => resetAppearance(packId, id)));
    if (results.some((result) => result.status === "rejected")) console.warn(`Some action images of ${packId} could not be removed`);
  };
  const restoreDefaults = () => {
    update({ ...defaults, length: preferences.length });
    say("current", current?.custom ? "已恢复创建时的名字和性格。" : "已恢复角色默认的名字和性格。");
  };

  const saveNickname = () => {
    try { saveUserProfile({ nickname }); setNickname(nickname.trim()); if (message?.area === "profile") setMessage(null); }
    catch (reason) {
      console.error("Could not save the nickname", reason);
      say("profile", nickname.trim().length > USER_PROFILE_LIMITS.nickname ? `称呼最多 ${USER_PROFILE_LIMITS.nickname} 个字。` : STORAGE_FULL);
    }
  };

  const exportCharacter = async () => {
    if (!isCustomCharacter(packId) || transferBusy) return;
    setTransferBusy(true);
    try {
      const characterPackage = createCharacterPackage(packId, await listAppearances());
      const saved = await systemPlatform.saveCharacterPackage(characterPackageText(characterPackage), characterPackageFileName(preferences.name));
      if (saved) say("transfer", `已导出「${preferences.name}」角色包。`);
      else setMessage(null);
    } catch (reason) {
      console.error("Could not export the character", reason);
      say("transfer", String(reason).includes("too large") ? "角色包超过 80 MB，删掉不需要的动作图层后再导出。" : "角色包没能导出，请换一个保存位置再试。");
    } finally {
      setTransferBusy(false);
    }
  };

  const selectCharacterPackage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (file.size > MAX_CHARACTER_PACKAGE_BYTES) {
      say("transfer", "这个角色包超过 80 MB，无法导入。");
      return;
    }
    try {
      const characterPackage = parseCharacterPackage(await file.text());
      const summary = summarizeCharacterPackage(characterPackage);
      const taken = catalog.map((entry) => (entry.id === packId ? preferences.name : characterName(entry.id, entry.name)));
      setPendingImport({ characterPackage, summary, name: uniqueCharacterName(summary.name, taken) });
      setMessage(null);
    } catch (reason) {
      console.warn("Rejected a character package", reason);
      say("transfer", "这个文件不是有效的 AI Pet 角色包，或者已经损坏。 ");
    }
  };

  const importCharacter = async () => {
    if (!pendingImport || transferBusy) return;
    setTransferBusy(true);
    let id: string;
    try {
      id = await importCharacterPackage(renameCharacterPackage(pendingImport.characterPackage, pendingImport.name));
    } catch (reason) {
      console.error("Could not import the character", reason);
      const text = String(reason);
      say("transfer", text.includes("At most") ? "角色数量已经到上限了，先删掉一个不用的角色。" : "角色包没能导入，现有角色没有改动。请确认基础形象可用后再试。");
      setTransferBusy(false);
      return;
    }
    setPendingImport(null);
    onCatalogChange();
    try {
      saveActiveCharacter(id);
    } catch (reason) {
      console.error("Imported the character but could not switch to it", reason);
      say("transfer", "角色已经导入，请在角色列表里手动切换过去。");
    } finally {
      setTransferBusy(false);
    }
  };

  return <div className="settings-section">
    <div className="settings-section__intro"><h2>关于你</h2></div>
    <article className="settings-card ai-settings"><label className="ai-preference">你的称呼<input value={nickname} maxLength={USER_PROFILE_LIMITS.nickname} placeholder="所有角色都这样叫你，例如：阿龙" onChange={(event) => setNickname(event.currentTarget.value)} onBlur={saveNickname} /></label>{note("profile")}</article>

    <div className="settings-section__intro settings-section__intro--spaced"><h2>我的角色</h2><p>点一下切换，每个角色的设定和聊天记录分开保存</p></div>
    <div className="character-grid">
      {catalog.map((entry) => <button key={entry.id} type="button" className={entry.id === packId ? "character-tile is-current" : "character-tile"} aria-pressed={entry.id === packId} onClick={() => switchTo(entry.id)}>
        <CharacterAvatar picture={pictureFor(loadChatAppearance(entry.id).avatar, entry.actionImages)} className="character-tile__portrait" />
        <strong>{entry.id === packId ? preferences.name : characterName(entry.id, entry.name)}</strong>
        <small>{entry.id === packId ? "使用中" : entry.custom ? "自建角色" : "内置角色"}</small>
      </button>)}
      <button type="button" className={creating ? "character-tile character-tile--new is-current" : "character-tile character-tile--new"} onClick={() => { setCreating(true); setMessage(null); }}>
        <span className="character-tile__portrait">+</span><strong>新建角色</strong><small>起名字、定性格</small>
      </button>
    </div>
    {note("list")}

    {creating && <>
      <div className="settings-section__intro settings-section__intro--spaced"><h2>新建角色</h2><p>先借用一个现有形象，之后可以在「动作库」换成自己的图</p></div>
      <form className="settings-card ai-settings" onSubmit={create}>
        <label className="ai-preference">名字<input value={draft.name} maxLength={PERSONA_LIMITS.name} autoFocus placeholder="例如：阿橘" onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
        <label className="ai-preference">性格<textarea value={draft.personality} maxLength={PERSONA_LIMITS.personality} placeholder="例如：慵懒、爱撒娇的橘猫，说话常带“喵”" onChange={(event) => setDraft({ ...draft, personality: event.currentTarget.value })} /><small className="ai-preference__count">已写 {draft.personality.length} / {PERSONA_LIMITS.personality}</small></label>
        {looks.length > 1 && <label className="ai-preference">形象<select value={draft.base} onChange={(event) => setDraft({ ...draft, base: event.currentTarget.value })}>{looks.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
        <div className="ai-settings__actions"><button type="button" onClick={() => { setCreating(false); setDraft(EMPTY_DRAFT); setMessage(null); }}>取消</button><button type="submit" className="is-primary" disabled={!draft.name.trim()}>创建并切换</button></div>
        {note("create")}
      </form>
    </>}

    {!creating && <>
    <div className="settings-section__intro settings-section__intro--spaced"><h2>当前角色</h2><p>名字和性格会随聊天发给 AI</p></div>
    <article className="settings-card ai-settings">
      <label className="ai-preference">名字<input value={preferences.name} maxLength={PERSONA_LIMITS.name} onChange={(event) => setPreferences({ ...preferences, name: event.currentTarget.value })} onBlur={() => update({ ...preferences, name: preferences.name.trim() || defaults.name })} /></label>
      <label className="ai-preference">性格<textarea value={preferences.personality} maxLength={PERSONA_LIMITS.personality} onChange={(event) => update({ ...preferences, personality: event.currentTarget.value })} /><small className="ai-preference__count">已写 {preferences.personality.length} / {PERSONA_LIMITS.personality}</small></label>
      <div className="ai-settings__actions">
        <ConfirmButton confirm={{ message: "改回默认的名字和性格？", detail: "你改过的名字和性格会换回默认，回复长度不变。", action: "恢复默认" }} onConfirm={restoreDefaults}>恢复默认</ConfirmButton>
        {isCustomCharacter(packId) && <ConfirmButton className="is-danger" confirm={{ message: "删除这个角色？", detail: "它的聊天记录、快捷按钮和动作图片会一起删掉，不能恢复。", action: "删除" }} onConfirm={() => void remove()}>删除这个角色</ConfirmButton>}
      </div>
      {note("current")}
    </article>
    </>}

    <div className="settings-section__intro settings-section__intro--spaced"><h2>形象</h2><p>聊天窗口里显示的头像和小人</p></div>
    {current && <ChatLookSettings packId={packId} actionImages={current.actionImages} onChange={() => setLookVersion((version) => version + 1)} />}

    <div className="settings-section__intro settings-section__intro--spaced"><h2>导入与导出</h2><p>把自建角色带到另一台电脑</p></div>
    <article className="settings-card ai-settings">
      <div className="settings-row">
        <div className="settings-row__body"><strong>导出当前角色</strong><span>{current?.custom ? "包含设定、动作图片和快捷按钮，不含聊天记录" : "内置角色不用导出"}</span></div>
        <button type="button" className="settings-button settings-button--small" disabled={!current?.custom || transferBusy} onClick={() => void exportCharacter()}>{transferBusy ? "处理中…" : "导出角色包"}</button>
      </div>
      <div className="settings-row">
        <div className="settings-row__body"><strong>导入角色包</strong><span>会新增一个角色，不影响现有的</span></div>
        <label className={transferBusy ? "settings-button settings-button--small icon-upload is-disabled" : "settings-button settings-button--small icon-upload"}>
          <input type="file" accept="application/json,.json" disabled={transferBusy} onChange={(event) => void selectCharacterPackage(event)} />选择文件…
        </label>
      </div>
      {pendingImport && <div className="settings-row backup-confirm" role="alertdialog" aria-label="确认导入角色包">
        <div className="settings-row__body"><strong>导入「{pendingImport.summary.name}」？</strong><span>{pendingImport.name !== pendingImport.summary.name && `已经有叫「${pendingImport.summary.name}」的角色，导入后会改名为「${pendingImport.name}」。`}将新增一个角色，包含动作图片 {pendingImport.summary.actions} 张、自定义动作 {pendingImport.summary.customActions} 个、带图层的动作 {pendingImport.summary.layeredActions} 个。</span></div>
        <div className="settings-button-row"><button type="button" className="settings-button settings-button--small" disabled={transferBusy} onClick={() => setPendingImport(null)}>取消</button><button type="button" className="settings-button settings-button--small" disabled={transferBusy} onClick={() => void importCharacter()}>{transferBusy ? "正在导入…" : "导入并切换"}</button></div>
      </div>}
      {note("transfer")}
    </article>
  </div>;
}
