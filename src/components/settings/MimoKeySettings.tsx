import { useEffect, useState, type FormEvent } from "react";
import { classifyServiceError } from "../../chat/serviceErrors";
import { mimoPlatform } from "../../platform/mimo";
import { systemPlatform } from "../../platform/system";
import { ConfirmButton } from "../ConfirmButton";
import { ServiceRow } from "./ServiceRow";

/** Where MiMo API keys are made: the API Keys page of the MiMo console. */
const MIMO_CONSOLE = "https://platform.xiaomimimo.com/";

/** What to say when saving or removing a key failed: the reason, never the raw error. */
function keyError(reason: unknown, doing: string): string {
  const text = String(reason);
  console.error(`MiMo key ${doing} failed`, reason);
  if (classifyServiceError(text) === "key-storage") return "本机 API Key 无法读写，请检查应用数据目录权限并重新保存。";
  if (text.includes("格式")) return text.replace(/^Error:\s*/, "");
  return `${doing}失败，请再试一次。`;
}

/** The MiMo key for speech recognition and MiMo's built-in read-aloud voices. */
export function MimoKeySettings() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  /** Optional: the form stays behind its button even while no key is saved, so a new user sees only what DeepSeek needs. */
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { mimoPlatform.keyStatus().then(setConfigured).catch(() => { setConfigured(false); setStatus("本机 API Key 配置不可用，请在 AI Pet 应用里设置。"); }); }, []);
  const saveKey = async (event: FormEvent) => {
    event.preventDefault(); if (!key.trim()) return;
    setBusy(true); setStatus("");
    try { await mimoPlatform.saveKey(key); setConfigured(true); setKey(""); setStatus("已在本机加密保存。在聊天窗口点麦克风试一句，能识别出来就说明 API Key 可用。"); }
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
  return <ServiceRow name="小米 MiMo" purpose="语音输入和 MiMo 内置音色朗读" configured={configured} optional expanded={expanded} onToggle={() => setExpanded((open) => !open)} status={status}>
    <form onSubmit={(event) => void saveKey(event)}><label htmlFor="mimo-key">API Key</label><div className="ai-settings__key"><input className="ui-field ui-field--small" id="mimo-key" type="password" autoComplete="off" autoFocus value={key} onChange={(event) => setKey(event.currentTarget.value)} placeholder={configured ? "输入新的 API Key 以替换" : "粘贴 MiMo API Key"} /><button type="submit" disabled={busy || !key.trim()}>保存</button></div></form>
    <p>录音会发给小米识别，可能产生少量费用，识别完不保存。</p>
    <div className="ai-settings__actions">
      {configured && <ConfirmButton disabled={busy} confirm={{ message: "移除 MiMo API Key？", detail: "API Key 会从本机配置中移除，之后要重新填写才能用语音。", action: "移除" }} onConfirm={() => void clearKey()}>移除 API Key</ConfirmButton>}
      <button type="button" className="ai-settings__link" onClick={openConsole}>获取 API Key ↗</button>
    </div>
  </ServiceRow>;
}
