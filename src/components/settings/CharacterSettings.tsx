import { useState, type FormEvent } from "react";
import { loadUserActions } from "../../actions/UserActions";
import { resetAppearance } from "../../appearance/AppearanceStore";
import type { AnimationEntry, PetPersona } from "../../assets/Manifest";
import { createCustomCharacter, DEFAULT_PACK_ID, deleteCustomCharacter, isCustomCharacter, type CatalogEntry } from "../../assets/PackCatalog";
import { clearCharacterData, saveActiveCharacter } from "../../preferences/CharacterPreferences";
import { loadChatAppearance, pictureFor } from "../../preferences/ChatAppearance";
import { characterName, chatDefaults, loadChatPreferences, saveChatPreferences, type ChatPreferences } from "../../preferences/ChatPreferences";
import { loadUserProfile, saveUserProfile, USER_PROFILE_LIMITS } from "../../preferences/UserProfile";
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
type Area = "profile" | "list" | "create" | "current";

/** Pick, rename and create characters. Everything here belongs to one character at a time. */
export function CharacterSettings({ packId, catalog, persona, actions, onCatalogChange }: Props) {
  const defaults = chatDefaults(persona);
  const [preferences, setPreferences] = useState(() => loadChatPreferences(packId, persona));
  const [nickname, setNickname] = useState(() => loadUserProfile().nickname);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [message, setMessage] = useState<{ area: Area; text: string } | null>(null);
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

  return <div className="settings-section">
    <div className="settings-section__intro"><h2>关于你</h2><p>所有角色都会这样称呼你。</p></div>
    <article className="settings-card ai-settings"><label className="ai-preference">你的称呼<input value={nickname} maxLength={USER_PROFILE_LIMITS.nickname} placeholder="比如：阿龙。留空就不特别称呼" onChange={(event) => setNickname(event.currentTarget.value)} onBlur={saveNickname} /></label>{note("profile")}</article>

    <div className="settings-section__intro settings-section__intro--spaced"><h2>我的角色</h2><p>每个角色有自己的名字、性格、聊天记录和动作图片。点一下就能切换。</p></div>
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
      <div className="settings-section__intro settings-section__intro--spaced"><h2>新建角色</h2><p>先借用一个现有形象。创建后可以在「动作库」复制提示词，用 ChatGPT 按你的参考图画一整套动作图，再逐个替换。</p></div>
      <form className="settings-card ai-settings" onSubmit={create}>
        <label className="ai-preference">名字<input value={draft.name} maxLength={PERSONA_LIMITS.name} autoFocus placeholder="例如：阿橘" onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
        <label className="ai-preference">性格<textarea value={draft.personality} maxLength={PERSONA_LIMITS.personality} placeholder="例如：慵懒、爱撒娇的橘猫，说话常带“喵”" onChange={(event) => setDraft({ ...draft, personality: event.currentTarget.value })} /><small className="ai-preference__count">已写 {draft.personality.length} / {PERSONA_LIMITS.personality}</small></label>
        {looks.length > 1 && <label className="ai-preference">形象<select value={draft.base} onChange={(event) => setDraft({ ...draft, base: event.currentTarget.value })}>{looks.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
        <div className="ai-settings__actions"><button type="button" onClick={() => { setCreating(false); setDraft(EMPTY_DRAFT); setMessage(null); }}>取消</button><button type="submit" className="is-primary" disabled={!draft.name.trim()}>创建并切换</button></div>
        {note("create")}
      </form>
    </>}

    <div className="settings-section__intro settings-section__intro--spaced"><h2>当前角色</h2><p>名字会显示在聊天窗口里，名字和性格都会随对话发给 AI。</p></div>
    <article className="settings-card ai-settings">
      <label className="ai-preference">名字<input value={preferences.name} maxLength={PERSONA_LIMITS.name} onChange={(event) => setPreferences({ ...preferences, name: event.currentTarget.value })} onBlur={() => update({ ...preferences, name: preferences.name.trim() || defaults.name })} /></label>
      <label className="ai-preference">性格<textarea value={preferences.personality} maxLength={PERSONA_LIMITS.personality} onChange={(event) => update({ ...preferences, personality: event.currentTarget.value })} /><small className="ai-preference__count">已写 {preferences.personality.length} / {PERSONA_LIMITS.personality}</small></label>
      <div className="ai-settings__actions">
        <ConfirmButton confirmLabel="再点一次，改回默认的名字和性格" onConfirm={restoreDefaults}>恢复默认</ConfirmButton>
        {isCustomCharacter(packId) && <ConfirmButton className="is-danger" confirmLabel="再点一次删除，聊天记录和动作图片一起删掉" onConfirm={() => void remove()}>删除这个角色</ConfirmButton>}
      </div>
      {note("current")}
    </article>

    <div className="settings-section__intro settings-section__intro--spaced"><h2>形象</h2><p>聊天窗口里的头像和小人。可以用角色自己的动作图，也可以上传图片。</p></div>
    {current && <ChatLookSettings packId={packId} actions={actions} actionImages={current.actionImages} onChange={() => setLookVersion((version) => version + 1)} />}
  </div>;
}
