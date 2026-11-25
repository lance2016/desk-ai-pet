import { useState } from "react";
import { loadAutoTitles, saveAutoTitles } from "../../chat/ChatThreads";
import { loadVoiceLanguage, saveVoiceLanguage, type VoiceLanguage } from "../../preferences/VoicePreferences";
import { QuickChatSettings } from "./QuickChatSettings";
import { moveRadioChoice } from "./radioKeys";

const LANGUAGES: readonly [VoiceLanguage, string][] = [["auto", "自动"], ["zh", "中文"], ["en", "English"]];
const NOT_SAVED = "设置没能保存，请再试一次。";

/** 「聊天」: how the user calls the pet up to talk, and what happens during a chat. What the pet may do is on 「能力」. */
export function ChatSettings({ packId, onError }: { packId: string; onError: (message: string | null) => void }) {
  const [autoTitles, setAutoTitles] = useState(loadAutoTitles);
  const [language, setLanguage] = useState(() => loadVoiceLanguage(packId));
  const toggleAutoTitles = () => {
    try { saveAutoTitles(!autoTitles); setAutoTitles(!autoTitles); onError(null); }
    catch (reason) { console.error("Could not save the title setting", reason); onError(NOT_SAVED); }
  };
  const updateLanguage = (next: VoiceLanguage) => {
    try { saveVoiceLanguage(next); setLanguage(next); onError(null); }
    catch (reason) { console.error("Could not save the voice language", reason); onError("识别语言没能保存，请再试一次。"); }
  };
  return <div className="settings-section">
    <div className="settings-section__intro"><h2>快速聊天</h2><p>点聊天按钮或按快捷键，在宠物旁边打字聊天，所有角色共用。快捷键在「通用」里改</p></div>
    <QuickChatSettings onError={onError} />
    <h2 className="settings-group-title">聊天时</h2>
    <div className="settings-group">
      <div className="settings-row"><div className="settings-row__body"><strong>自动生成聊天标题</strong><span>在本机整理开场白中的空格和标点</span></div><button type="button" role="switch" aria-label="自动生成聊天标题" aria-checked={autoTitles} className={autoTitles ? "ui-switch is-on" : "ui-switch"} onClick={toggleAutoTitles}><span /></button></div>
      <div className="settings-row"><div className="settings-row__body"><strong>语音识别语言</strong><span>中英文混着说就选「自动」</span></div><div className="ui-segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="语音识别语言">{LANGUAGES.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={language === value} className={language === value ? "is-selected" : ""} onClick={() => updateLanguage(value)}>{label}</button>)}</div></div>
    </div>
  </div>;
}
