import { useState } from "react";
import { loadAutoTitles, saveAutoTitles } from "../../chat/ChatThreads";
import { QuickChatSettings } from "./QuickChatSettings";

/** 「聊天」: how the user calls the pet up to talk, and how chats are kept. Shared by every character. */
export function ChatSettings({ onError }: { onError: (message: string | null) => void }) {
  const [autoTitles, setAutoTitles] = useState(loadAutoTitles);
  const toggleAutoTitles = () => {
    try { saveAutoTitles(!autoTitles); setAutoTitles(!autoTitles); onError(null); }
    catch (reason) { console.error("Could not save the title setting", reason); onError("设置没能保存，请再试一次。"); }
  };
  return <div className="settings-section">
    <div className="settings-section__intro"><h2>快速聊天</h2><p>在宠物旁边打字聊天，所有角色共用</p></div>
    <QuickChatSettings onError={onError} />
    <h2 className="settings-group-title">聊天记录</h2>
    <div className="settings-group"><div className="settings-row"><div className="settings-row__body"><strong>自动生成聊天标题</strong><span>在本机整理开场白中的空格和标点</span></div><button type="button" role="switch" aria-label="自动生成聊天标题" aria-checked={autoTitles} className={autoTitles ? "toggle is-on" : "toggle"} onClick={toggleAutoTitles}><span /></button></div></div>
  </div>;
}
