import { useEffect, useState, type FormEvent } from "react";
import { classifyServiceError } from "../../chat/serviceErrors";
import { mimoPlatform } from "../../platform/mimo";
import { systemPlatform } from "../../platform/system";
import { loadVoiceLanguage, saveVoiceLanguage, type VoiceLanguage } from "../../preferences/VoicePreferences";
import { ConfirmButton } from "../ConfirmButton";
import { moveRadioChoice } from "./radioKeys";

/** Where MiMo API keys are made: the API Keys page of the MiMo console. */
const MIMO_CONSOLE = "https://platform.xiaomimimo.com/";
const LANGUAGES: readonly [VoiceLanguage, string][] = [["auto", "自动"], ["zh", "中文"], ["en", "English"]];

/** What to say when saving or removing a key failed: the reason, never the raw error. */
function keyError(reason: unknown, doing: string): string {
  const text = String(reason);
  console.error(`MiMo key ${doing} failed`, reason);
  if (classifyServiceError(text) === "key-storage") return "本机 API Key 无法读写，请检查应用数据目录权限并重新保存。";
  if (text.includes("格式")) return text.replace(/^Error:\s*/, "");
  return `${doing}失败，请再试一次。`;
}

export function VoiceSettings({ packId }: { packId: string }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [language, setLanguage] = useState(() => loadVoiceLanguage(packId));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  /** Same rule as the DeepSeek key: the form is open while no key is saved, and behind "管理 API Key" after. */
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (configured === false) setExpanded(true); }, [configured]);
  useEffect(() => { mimoPlatform.keyStatus().then(setConfigured).catch(() => { setConfigured(false); setStatus("本机 API Key 配置不可用，请在 AI Pet 应用里设置。"); }); }, []);
  const updateLanguage = (next: VoiceLanguage) => {
    setLanguage(next);
    try { saveVoiceLanguage(next); setStatus(""); } catch (reason) { console.error("Could not save the voice language", reason); setStatus("识别语言没能保存，请再试一次。"); }
  };
  const saveKey = async (event: FormEvent) => {
    event.preventDefault(); if (!key.trim()) return;
    setBusy(true); setStatus("");
    try { await mimoPlatform.saveKey(key); setConfigured(true); setKey(""); setStatus("已在本机加密保存。在聊天窗口点麦克风试一句，能识别出来就说明 Key 可用。"); }
    catch (reason) { setStatus(keyError(reason, "保存")); }
    finally { setBusy(false); }
  };
  const clearKey = async () => {
    setBusy(true); setStatus("");
    try { await mimoPlatform.clearKey(); setConfigured(false); setStatus("已移除 MiMo API Key。"); }
    catch (reason) { setStatus(keyError(reason, "移除")); }
    finally { setBusy(false); }
  };
  const openConsole = () => void systemPlatform.openLink(MIMO_CONSOLE).catch((reason: unknown) => { console.error("Could not open the MiMo console", reason); setStatus("没能打开网页，可以自己在浏览器里打开 platform.xiaomimimo.com。"); });
  return <div className="settings-section">
    <div className="settings-section__intro"><h2>语音输入</h2><p>说话转成文字填进输入框，你看过再发。不填 API Key 也能打字聊天</p></div>
    <article className="settings-card ai-settings">
      <div className="ai-settings__head"><div><strong>小米 MiMo</strong><span>用小米账号在 MiMo 控制台新建 API Key</span></div><span className={configured ? "ai-badge is-ready" : "ai-badge"}>{configured === null ? "检查中" : configured ? "已配置" : "未配置"}</span>{configured && <button type="button" className="settings-button settings-button--small" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>{expanded ? "收起" : "管理 API Key"}</button>}</div>
      {expanded && <><form onSubmit={(event) => void saveKey(event)}><label htmlFor="mimo-key">API Key</label><div className="ai-settings__key"><input id="mimo-key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.currentTarget.value)} placeholder={configured ? "输入新的 API Key 以替换" : "粘贴 MiMo API Key"} /><button type="submit" disabled={busy || !key.trim()}>保存</button></div></form>
      <p>录音会发给小米识别，可能产生少量费用，识别完不保存。</p>
      <div className="ai-settings__actions">
        {configured && <ConfirmButton disabled={busy} confirm={{ message: "移除 MiMo API Key？", detail: "API Key 会从本机配置中移除，之后要重新填写才能用语音。", action: "移除" }} onConfirm={() => void clearKey()}>移除 API Key</ConfirmButton>}
        <button type="button" className="ai-settings__link" onClick={openConsole}>获取 API Key ↗</button>
      </div></>}
      {status && <p className="ai-settings__status" role="status">{status}</p>}
    </article>
    <div className="settings-section__intro settings-section__intro--spaced"><h2>识别</h2><p>所有角色共用</p></div>
    <div className="settings-group">
      <div className="settings-row"><div className="settings-row__body"><strong>语音识别语言</strong><span>中英文混着说就选「自动」</span></div><div className="segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="语音识别语言">{LANGUAGES.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={language === value} className={language === value ? "is-selected" : ""} onClick={() => updateLanguage(value)}>{label}</button>)}</div></div>
    </div>
    <p className="settings-footnote">点聊天窗口的麦克风开始录音，每次最长 2 分钟</p>
  </div>;
}
