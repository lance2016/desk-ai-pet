import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ai } from "../../ai";
import { classifyServiceError, serviceErrorMessage } from "../../chat/serviceErrors";
import { loadChatModel } from "../../preferences/ChatModel";
import { ModelSettings } from "./ModelSettings";
import { ConfirmButton } from "../ConfirmButton";
import { MimoKeySettings } from "./MimoKeySettings";
import { CosyVoiceKeySettings } from "./CosyVoiceKeySettings";
import { ServiceRow } from "./ServiceRow";
import { Chevron } from "./Chevron";

/** A failed key action in words the user can act on; the raw error goes to the log. */
export function deepSeekProblem(reason: unknown, doing: string): string {
  const text = String(reason);
  console.error(`DeepSeek ${doing} failed`, reason);
  if (text.includes("格式")) return text.replace(/^Error:\s*/, "");
  const kind = classifyServiceError(text);
  return kind === "other" ? `${doing}失败，请再试一次。` : serviceErrorMessage("DeepSeek", kind);
}

interface Props {
  /** The icon of the cloned-voices page, drawn by the settings page. */
  clonesIcon: ReactNode;
  onOpenClones: () => void;
}

/**
 * 「AI 服务」: which services the app connects to, shared by every character. DeepSeek for chat is the one
 * that is needed; MiMo (voice input, preset voices) and Bailian (cloned voices) stay folded until asked for.
 * How each character sounds is on its own 「角色设定」.
 */
export function AISettings({ clonesIcon, onOpenClones }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [connectionExpanded, setConnectionExpanded] = useState(false);
  useEffect(() => { ai.keyStatus().then(setConfigured).catch(() => { setConfigured(false); setStatus("读不到本机 API Key 配置，请在 AI Pet 应用里设置。"); }); }, []);
  const needsKey = configured === false;
  useEffect(() => { if (needsKey) setConnectionExpanded(true); }, [needsKey]);

  const test = async () => {
    setBusy(true); setStatus("正在测试连接…");
    try { await ai.test(loadChatModel()); setStatus("连接成功，可以开始聊天了。"); }
    catch (error) { setStatus(deepSeekProblem(error, "测试连接")); }
    finally { setBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!key.trim()) return;
    setBusy(true); setStatus("");
    try { await ai.saveKey(key); setKey(""); setConfigured(true); }
    catch (error) { setStatus(deepSeekProblem(error, "保存")); setBusy(false); return; }
    setBusy(false);
    await test();
  };
  const clear = async () => {
    setBusy(true); setStatus("");
    try { await ai.clearKey(); setConfigured(false); setStatus("已移除 API Key。"); }
    catch (error) { setStatus(deepSeekProblem(error, "移除")); }
    finally { setBusy(false); }
  };

  return <div className="settings-section ai-page">
    {needsKey && <div className="ai-page__intro"><p>配置一次 DeepSeek，所有角色都可以和你聊天</p></div>}
    <section className="ai-section" aria-labelledby="ai-connection-heading">
      <div className="ai-section__title"><h2 id="ai-connection-heading">连接与模型</h2><p>聊天、划词和问候都用它，所有角色共用</p></div>
      <div className="settings-group">
        <ServiceRow name="DeepSeek" purpose={configured === false ? "填上 API Key 才能聊天" : "聊天用的模型服务"} configured={configured} expanded={connectionExpanded} onToggle={() => setConnectionExpanded((open) => !open)} status={status}>
          <form onSubmit={(event) => void save(event)}><label htmlFor="deepseek-key">API Key</label><div className="ai-settings__key"><input className="ui-field ui-field--small" id="deepseek-key" type="password" autoComplete="off" autoFocus value={key} onChange={(event) => setKey(event.currentTarget.value)} placeholder={configured ? "输入新的 API Key 以替换" : "粘贴 DeepSeek API Key"} /><button type="submit" disabled={busy || !key.trim()}>保存</button></div></form>
          <p>从旧版升级，请重新粘贴一次 API Key。保存后会自动测试一次。DeepSeek 按用量收费。</p>
          <div className="ai-settings__actions"><button type="button" disabled={busy || !configured} onClick={() => void test()}>测试连接</button><ConfirmButton disabled={busy || !configured} confirm={{ message: "移除 DeepSeek API Key？", detail: "API Key 会从本机配置中移除，之后要重新填写才能聊天。", action: "移除" }} onConfirm={() => void clear()}>移除 API Key</ConfirmButton><button type="button" className="ai-settings__link" onClick={() => void ai.openKeyPage().catch((error: unknown) => { console.error("Could not open the DeepSeek page", error); setStatus("没能打开网页，可以自己在浏览器里打开 platform.deepseek.com。"); })}>获取 API Key ↗</button></div>
        </ServiceRow>
      </div>
      <div className="ai-model"><ModelSettings keyConfigured={configured} /></div>
    </section>
    <section className="ai-section" aria-labelledby="ai-voice-heading">
      <div className="ai-section__title"><h2 id="ai-voice-heading">语音</h2><p>可选。不配也能打字聊天；每个角色用哪个声音，在它的「角色设定」里选</p></div>
      <div className="settings-group">
        <MimoKeySettings />
        <CosyVoiceKeySettings />
        <button type="button" className="settings-row settings-link" onClick={onOpenClones}>{clonesIcon}<span className="settings-row__body"><strong>克隆的声音</strong><span>录一段或选个文件，让角色用这个声音说话</span></span><Chevron /></button>
      </div>
    </section>
  </div>;
}
