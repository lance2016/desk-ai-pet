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
import { VoiceSettings } from "./VoiceSettings";
import { systemPlatform } from "../../platform/system";
import { listAppearances } from "../../appearance/AppearanceStore";
import { characterPackageFileName, characterPackageText, createCharacterPackage } from "../../storage/CharacterPackage";

interface Props {
  packId: string;
  persona?: PetPersona;
  actions: AnimationEntry[];
  current?: CatalogEntry;
  onCatalogChange: () => void;
  /** The avatar or the chat figure changed. */
  onLookChange: () => void;
  onOpenClones: () => void;
}

const LENGTHS: readonly [ChatPreferences["length"], string][] = [["short", "简短"], ["normal", "自然"]];
const STORAGE_FULL = "没能保存：这台电脑上给 AI Pet 的存储空间满了。删掉几张自定义图片再试。";

/** The selected character's conversational style and appearance. */
export function CharacterProfileSettings({ packId, persona, actions, current, onCatalogChange, onLookChange, onOpenClones }: Props) {
  const defaults = chatDefaults(persona);
  const [preferences, setPreferences] = useState(() => loadChatPreferences(packId, persona));
  const [instructions, setInstructions] = useState(() => loadChatInstructions(packId));
  const [status, setStatus] = useState("");
  const [, setLookVersion] = useState(0);
  const [exporting, setExporting] = useState(false);
  const exportCharacter = async () => {
    setExporting(true);
    try {
      const characterPackage = createCharacterPackage(packId, await listAppearances());
      const saved = await systemPlatform.saveCharacterPackage(characterPackageText(characterPackage), characterPackageFileName(preferences.name));
      setStatus(saved ? `已导出「${preferences.name}」角色包。` : "");
    } catch (reason) {
      console.error("Could not export the character", reason);
      setStatus(String(reason).includes("too large") ? "角色包超过 80 MB，删掉不需要的动作图层后再导出。" : "角色包没能导出，请换一个保存位置再试。");
    } finally { setExporting(false); }
  };
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
    {/* The page title names the character; everything here is its own and leaves the others alone. */}
    <article className="settings-card ai-settings">
      <label className="ai-preference"><strong>名字</strong><input className="ui-field" value={preferences.name} maxLength={PERSONA_LIMITS.name} onChange={(event) => setPreferences({ ...preferences, name: event.currentTarget.value })} onBlur={() => { update({ ...preferences, name: preferences.name.trim() || defaults.name }); onCatalogChange(); }} /></label>
      <div className="ai-preference">
        <div className="ai-instructions__foot character-profile__personality-head"><label htmlFor="character-personality"><strong>性格</strong></label><span>{preferences.personality.length} / {PERSONA_LIMITS.personality}<ConfirmButton className="ui-link" confirm={{ message: "改回默认的名字和性格？", detail: "你改过的名字和性格会换回默认，回复长度不变。", action: "恢复默认" }} onConfirm={restoreDefaults}>恢复默认</ConfirmButton></span></div>
        <textarea className="ui-textarea" id="character-personality" value={preferences.personality} maxLength={PERSONA_LIMITS.personality} onChange={(event) => update({ ...preferences, personality: event.currentTarget.value })} />
      </div>
    </article>

    <h2 className="settings-group-title">回复方式</h2>
    <div className="settings-group character-profile__replies">
      <div className="settings-row"><div className="settings-row__body"><strong>回复长度</strong><span>简短适合闲聊，自然会多解释几句</span></div><div className="ui-segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="回复长度">{LENGTHS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={preferences.length === value} className={preferences.length === value ? "is-selected" : ""} onClick={() => update({ ...preferences, length: value })}>{label}</button>)}</div></div>
      <div className="character-profile__instructions">
        <div className="ai-instructions__foot character-profile__instructions-head"><label htmlFor="character-instructions"><strong>补充要求</strong></label><span>自动保存 · {instructions.length} / {CHAT_INSTRUCTIONS_LIMIT}</span></div>
        <textarea className="ui-textarea" id="character-instructions" value={instructions} maxLength={CHAT_INSTRUCTIONS_LIMIT} placeholder="例如：聊天时简短一些，讨论技术问题时详细解释" onChange={(event) => updateInstructions(event.currentTarget.value)} />
      </div>
    </div>

    <VoiceSettings packId={packId} persona={persona} characterName={preferences.name} onOpenClones={onOpenClones} />

    <h2 className="settings-group-title">形象</h2>
    {current && <ChatLookSettings packId={packId} actionImages={current.actionImages} onChange={() => { setLookVersion((version) => version + 1); onLookChange(); }} />}
    {isCustomCharacter(packId) && <>
      <h2 className="settings-group-title">角色管理</h2>
      <div className="settings-group"><div className="settings-row"><div className="settings-row__body"><strong>导出角色包</strong><span>带到另一台电脑：设定、动作图片和快捷按钮，不含聊天记录</span></div><button type="button" className="ui-button ui-button--small" disabled={exporting} onClick={() => void exportCharacter()}>{exporting ? "正在导出…" : "导出…"}</button></div><div className="settings-row"><div className="settings-row__body"><strong>删除这个角色</strong><span>聊天记录、快捷按钮和动作图片会一起删除，不能恢复</span></div><ConfirmButton className="is-danger ui-button ui-button--small" confirm={{ message: "删除这个角色？", detail: "它的聊天记录、快捷按钮和动作图片会一起删掉，不能恢复。", action: "删除" }} onConfirm={() => void remove()}>删除…</ConfirmButton></div></div>
    </>}
    {status && <p className="ai-settings__status" role="status">{status}</p>}
  </div>;
}
