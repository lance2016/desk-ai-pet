import { useState } from "react";
import type { AnimationEntry, PetPersona } from "../../assets/Manifest";
import { clearCharacterData, saveActiveCharacter } from "../../preferences/CharacterPreferences";
import { chatDefaults, loadChatPreferences, saveChatPreferences, type ChatPreferences } from "../../preferences/ChatPreferences";
import { CHAT_INSTRUCTIONS_LIMIT, loadChatInstructions, saveChatInstructions } from "../../preferences/ChatInstructions";
import { DEFAULT_PACK_ID, deleteCustomCharacter, isCustomCharacter, type CatalogEntry } from "../../assets/PackCatalog";
import { loadUserActions } from "../../actions/UserActions";
import { resetAppearance } from "../../appearance/AppearanceStore";
import { PERSONA_LIMITS } from "../../types";
import { ConfirmButton } from "../ConfirmButton";
import { ChatLookSettings } from "./ChatLookSettings";
import { moveRadioChoice } from "./radioKeys";

interface Props {
  packId: string;
  persona?: PetPersona;
  actions: AnimationEntry[];
  current?: CatalogEntry;
  onCatalogChange: () => void;
}

const LENGTHS: readonly [ChatPreferences["length"], string][] = [["short", "简短"], ["normal", "自然"]];
const STORAGE_FULL = "没能保存：这台电脑上给 AI Pet 的存储空间满了。删掉几张自定义图片再试。";

/** The selected character's conversational style and appearance. */
export function CharacterProfileSettings({ packId, persona, actions, current, onCatalogChange }: Props) {
  const defaults = chatDefaults(persona);
  const [preferences, setPreferences] = useState(() => loadChatPreferences(packId, persona));
  const [instructions, setInstructions] = useState(() => loadChatInstructions(packId));
  const [status, setStatus] = useState("");
  const [, setLookVersion] = useState(0);
  const update = (next: ChatPreferences) => {
    setPreferences(next);
    try { saveChatPreferences(packId, next); setStatus(""); }
    catch (reason) { console.error("Could not save the character", reason); setStatus(STORAGE_FULL); }
  };
  const updateInstructions = (next: string) => {
    setInstructions(next);
    try { saveChatInstructions(packId, next); setStatus(""); }
    catch (reason) { console.error("Could not save the character instructions", reason); setStatus("补充要求没能保存，请再试一次。"); }
  };
  const restoreDefaults = () => {
    update({ ...defaults, length: preferences.length });
    setStatus("已恢复创建时的名字和性格。");
  };
  const remove = async () => {
    const pictures = [...actions.map((action) => action.id), ...loadUserActions(packId).map((action) => action.id)];
    try {
      saveActiveCharacter(DEFAULT_PACK_ID);
      deleteCustomCharacter(packId);
      clearCharacterData(packId);
      onCatalogChange();
    } catch (reason) { console.error("Could not delete the character", reason); setStatus("没能删除这个角色，请再试一次。"); return; }
    const results = await Promise.allSettled([...new Set(pictures)].map((id) => resetAppearance(packId, id)));
    if (results.some((result) => result.status === "rejected")) console.warn(`Some action images of ${packId} could not be removed`);
  };

  return <div className="settings-section character-profile">
    <div className="settings-section__intro"><h2>当前角色</h2><p>以下内容只影响「{preferences.name}」，不改变其他角色</p></div>
    <article className="settings-card ai-settings">
      <label className="ai-preference">名字<input value={preferences.name} maxLength={PERSONA_LIMITS.name} onChange={(event) => setPreferences({ ...preferences, name: event.currentTarget.value })} onBlur={() => { update({ ...preferences, name: preferences.name.trim() || defaults.name }); onCatalogChange(); }} /></label>
      <label className="ai-preference"><strong>性格</strong><textarea value={preferences.personality} maxLength={PERSONA_LIMITS.personality} onChange={(event) => update({ ...preferences, personality: event.currentTarget.value })} /><small className="ai-preference__count">已写 {preferences.personality.length} / {PERSONA_LIMITS.personality}</small></label>
      <div className="ai-settings__actions">
        <ConfirmButton confirm={{ message: "改回默认的名字和性格？", detail: "你改过的名字和性格会换回默认，回复长度不变。", action: "恢复默认" }} onConfirm={restoreDefaults}>恢复默认</ConfirmButton>
      </div>
    </article>

    <div className="settings-section__intro settings-section__intro--spaced"><h2>回复方式</h2><p>调节这只角色的聊天风格</p></div>
    <div className="settings-group character-profile__replies">
      <div className="settings-row"><div className="settings-row__body"><strong>回复长度</strong><span>简短适合闲聊，自然会多解释几句</span></div><div className="segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="回复长度">{LENGTHS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={preferences.length === value} className={preferences.length === value ? "is-selected" : ""} onClick={() => update({ ...preferences, length: value })}>{label}</button>)}</div></div>
      <div className="character-profile__instructions">
        <label htmlFor="character-instructions"><strong>补充要求</strong></label>
        <p>只对「{preferences.name}」生效，例如聊天时简短一些，讨论技术问题时详细解释。</p>
        <textarea id="character-instructions" value={instructions} maxLength={CHAT_INSTRUCTIONS_LIMIT} placeholder="给这只角色补充说话或回复要求" onChange={(event) => updateInstructions(event.currentTarget.value)} />
        <div className="ai-instructions__foot"><span>自动保存</span><span>{instructions.length} / {CHAT_INSTRUCTIONS_LIMIT}</span></div>
      </div>
    </div>

    <div className="settings-section__intro settings-section__intro--spaced"><h2>形象</h2><p>聊天窗口里显示的头像和小人，只影响当前角色</p></div>
    {current && <ChatLookSettings packId={packId} actionImages={current.actionImages} onChange={() => setLookVersion((version) => version + 1)} />}
    {isCustomCharacter(packId) && <>
      <div className="settings-section__intro settings-section__intro--spaced"><h2>角色管理</h2></div>
      <div className="settings-group"><div className="settings-row"><div className="settings-row__body"><strong>删除这个角色</strong><span>聊天记录、快捷按钮和动作图片会一起删除，不能恢复</span></div><ConfirmButton className="is-danger settings-button settings-button--small" confirm={{ message: "删除这个角色？", detail: "它的聊天记录、快捷按钮和动作图片会一起删掉，不能恢复。", action: "删除" }} onConfirm={() => void remove()}>删除…</ConfirmButton></div></div>
    </>}
    {status && <p className="ai-settings__status" role="status">{status}</p>}
  </div>;
}
