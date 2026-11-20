import { useEffect, useState, type FormEvent } from "react";
import { ai, type ChatPreview } from "../../ai";
import type { PetPersona } from "../../assets/Manifest";
import { classifyServiceError, serviceErrorMessage } from "../../chat/serviceErrors";
import { loadChatModel } from "../../preferences/ChatModel";
import { requestPreferences } from "../../preferences/ChatPreferences";
import { chatContext } from "../../agenda/chatTools";
import { currentChatFacts } from "../../facts/FactStore";
import { CHAT_SKILLS } from "../../skills";
import { ModelSettings } from "./ModelSettings";
import { ConfirmButton } from "../ConfirmButton";
import { ChatRequestDetails } from "./ChatRequestDetails";
import { loadReadLinks, saveReadLinks } from "../../preferences/ReadLinkPreferences";
import type { SettingsSection } from "./sections";

/** A failed key action in words the user can act on; the raw error goes to the log. */
export function deepSeekProblem(reason: unknown, doing: string): string {
  const text = String(reason);
  console.error(`DeepSeek ${doing} failed`, reason);
  if (text.includes("格式")) return text.replace(/^Error:\s*/, "");
  const kind = classifyServiceError(text);
  return kind === "other" ? `${doing}失败，请再试一次。` : serviceErrorMessage("DeepSeek", kind);
}

/** Shared AI connection, model and rules. Character-specific reply settings live with each character. */
export function AISettings({ packId, persona, actions, onOpen }: { packId: string; persona?: PetPersona; actions: string[]; onOpen: (section: SettingsSection) => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<ChatPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [connectionExpanded, setConnectionExpanded] = useState(false);
  const [readLinks, setReadLinks] = useState(loadReadLinks);
  useEffect(() => { ai.keyStatus().then(setConfigured).catch(() => { setConfigured(false); setStatus("读不到本机 API Key 配置，请在 AI Pet 应用里设置。"); }); }, []);
  const needsKey = configured === false;
  useEffect(() => { if (needsKey) setConnectionExpanded(true); }, [needsKey]);

  const toggleReadLinks = () => {
    try { saveReadLinks(!readLinks); setReadLinks(!readLinks); setStatus(""); }
    catch (reason) { console.error("Could not save link reading preference", reason); setStatus("设置没能保存，请再试一次。"); }
  };
  const showPreview = async () => {
    setPreviewError("");
    try { setPreview(ai.preview(requestPreferences(packId, persona), chatContext(Date.now(), actions, currentChatFacts()), CHAT_SKILLS)); }
    catch (reason) { console.error("Could not preview chat request", reason); setPreviewError("没能生成预览，请在桌面应用中重试。"); }
  };
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

  const connection = <section className="ai-section" aria-labelledby="ai-connection-heading">
    <div className="ai-section__title"><h2 id="ai-connection-heading">连接与模型</h2><p>所有角色共用</p></div>
    <div className="settings-group ai-connection-row"><div className="settings-row"><div className="settings-row__body"><strong>DeepSeek</strong><span>{configured === null ? "正在检查…" : configured ? "已连接" : "填上 API Key 才能聊天"}</span></div><button type="button" className="settings-button settings-button--small" aria-expanded={connectionExpanded} onClick={() => setConnectionExpanded((open) => !open)}>{connectionExpanded ? "收起" : "管理 API Key"}</button></div>
    {connectionExpanded && <div className="ai-connection-form ai-settings"><form onSubmit={(event) => void save(event)}><label htmlFor="deepseek-key">API Key</label><div className="ai-settings__key"><input id="deepseek-key" type="password" autoComplete="off" autoFocus={needsKey} value={key} onChange={(event) => setKey(event.currentTarget.value)} placeholder={configured ? "输入新的 API Key 以替换" : "粘贴 DeepSeek API Key"} /><button type="submit" disabled={busy || !key.trim()}>保存</button></div></form><p>从旧版升级，请重新粘贴一次 API Key。保存后会自动测试一次。DeepSeek 按用量收费。</p><div className="ai-settings__actions"><button type="button" disabled={busy || !configured} onClick={() => void test()}>测试连接</button><ConfirmButton disabled={busy || !configured} confirm={{ message: "移除 DeepSeek API Key？", detail: "API Key 会从本机配置中移除，之后要重新填写才能聊天。", action: "移除" }} onConfirm={() => void clear()}>移除 API Key</ConfirmButton><button type="button" className="ai-settings__link" onClick={() => void ai.openKeyPage().catch((error: unknown) => { console.error("Could not open the DeepSeek page", error); setStatus("没能打开网页，可以自己在浏览器里打开 platform.deepseek.com。"); })}>获取 API Key</button></div></div>}</div>
    {status && <p className="ai-inline-status" role="status">{status}</p>}
    <div className="ai-model"><ModelSettings keyConfigured={configured} /></div>
    <div className="settings-group ai-model">
      <div className="settings-row">
        <div className="settings-row__body"><strong>自动阅读网页链接</strong><span>在完整聊天里发送网页链接时，交给 DeepSeek</span></div>
        <button type="button" role="switch" aria-label="自动阅读网页链接" aria-checked={readLinks} className={readLinks ? "toggle is-on" : "toggle"} onClick={toggleReadLinks}><span /></button>
      </div>
    </div>
  </section>;

  return <div className="settings-section ai-page">
    {needsKey && <div className="ai-page__intro"><p>配置一次 DeepSeek，所有角色都可以和你聊天。</p></div>}
    {connection}
    <section className="ai-section ai-advanced" aria-labelledby="ai-advanced-heading">
      <div className="ai-section__title"><h2 id="ai-advanced-heading">通用对话规则</h2><p>适用于所有角色；预览会带入当前角色的设定</p></div>
      <div className="settings-card ai-preview"><div className="ai-preview__head"><div><strong>规则与能力</strong><span>每次聊天都会带上，可逐段调整</span></div><button type="button" className="settings-button settings-button--small" onClick={() => void showPreview()}>{preview ? "刷新预览" : "查看和修改"}</button></div>{previewError && <p role="status">{previewError}</p>}{preview && <ChatRequestDetails preview={preview} onChanged={() => void showPreview()} onError={setPreviewError} />}</div>
    </section>
    <div className="settings-group"><div className="settings-row"><div className="settings-row__body"><strong>功能一览</strong><span>查看 AI Pet 能做什么以及怎么使用</span></div><button type="button" className="settings-button settings-button--small" onClick={() => onOpen("guide")}>打开</button></div></div>
  </div>;
}
