import { useEffect, useState, type FormEvent } from "react";
import { classifyServiceError } from "../../chat/serviceErrors";
import { cosyvoicePlatform } from "../../platform/cosyvoice";
import { systemPlatform } from "../../platform/system";
import { ConfirmButton } from "../ConfirmButton";

const BAILIAN_CONSOLE = "https://bailian.console.aliyun.com/";

function keyError(reason: unknown, doing: string): string {
  const text = String(reason);
  console.error(`CosyVoice key ${doing} failed`, reason);
  if (classifyServiceError(text) === "key-storage") return "本机 API Key 无法读写，请检查应用数据目录权限并重新保存。";
  if (text.includes("格式")) return text.replace(/^Error:\s*/, "");
  return `${doing}失败，请再试一次。`;
}

/** The key used only for cloned voice enrollment, synthesis, and cloud deletion. */
export function CosyVoiceKeySettings() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    cosyvoicePlatform.keyStatus().then(setConfigured).catch((reason: unknown) => {
      console.error("Could not read CosyVoice key status", reason);
      setConfigured(false);
      setStatus("本机 API Key 配置不可用，请在 AI Pet 应用里设置。");
    });
  }, []);

  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    setBusy(true); setStatus("");
    try {
      await cosyvoicePlatform.saveKey(key);
      setConfigured(true); setKey("");
      setStatus("已在本机加密保存。添加或试听克隆声音时会验证 API Key。");
    } catch (reason) { setStatus(keyError(reason, "保存")); }
    finally { setBusy(false); }
  };

  const clearKey = async () => {
    setBusy(true); setStatus("");
    try {
      await cosyvoicePlatform.clearKey();
      setConfigured(false);
      setStatus("已移除阿里云百炼 API Key。");
    } catch (reason) { setStatus(keyError(reason, "移除")); }
    finally { setBusy(false); }
  };

  const openConsole = () => void systemPlatform.openLink(BAILIAN_CONSOLE).catch((reason: unknown) => {
    console.error("Could not open the Aliyun Model Studio console", reason);
    setStatus("没能打开网页，可以在浏览器里搜索「阿里云百炼控制台」。");
  });

  return <article className="settings-card ai-settings">
    <div className="ai-settings__head"><div><strong>阿里云百炼 · CosyVoice</strong><span>克隆音色和克隆声音朗读使用</span></div><span className={configured ? "ai-badge is-ready" : "ai-badge"}>{configured === null ? "检查中" : configured ? "已配置" : "未配置"}</span>{configured && <button type="button" className="ui-button ui-button--small" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>{expanded ? "收起" : "管理 API Key"}</button>}</div>
    {(!configured || expanded) && <>
      <form onSubmit={(event) => void saveKey(event)}><label htmlFor="cosyvoice-key">百炼 API Key</label><div className="ai-settings__key"><input className="ui-field ui-field--small" id="cosyvoice-key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.currentTarget.value)} placeholder={configured ? "输入新的 API Key 以替换" : "粘贴百炼 API Key"} /><button type="submit" disabled={busy || !key.trim()}>保存</button></div></form>
      <p>使用中国内地（北京）地域的百炼 API Key。录音会上传到阿里云创建并保存克隆音色；朗读时发送文字。删除云端音色也需要保留这个 Key。</p>
      <div className="ai-settings__actions">
        {configured && <ConfirmButton disabled={busy} confirm={{ message: "移除阿里云百炼 API Key？", detail: "移除后将无法创建、试听或删除云端克隆音色。要删除云端音色，请先在「克隆的声音」里删除。", action: "移除" }} onConfirm={() => void clearKey()}>移除 API Key</ConfirmButton>}
        <button type="button" className="ai-settings__link" onClick={openConsole}>获取百炼 API Key ↗</button>
      </div>
    </>}
    {status && <p className="ai-settings__status" role="status">{status}</p>}
  </article>;
}
