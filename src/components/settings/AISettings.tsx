import { useEffect, useState, type FormEvent } from "react";
import { ai, type ChatPreview } from "../../ai";
import type { PetPersona } from "../../assets/Manifest";
import { characterName, loadChatPreferences, saveChatPreferences, type ChatPreferences } from "../../preferences/ChatPreferences";
import { classifyServiceError, serviceErrorMessage } from "../../chat/serviceErrors";
import { loadChatModel } from "../../preferences/ChatModel";
import { ModelSettings } from "./ModelSettings";
import { ConfirmButton } from "../ConfirmButton";
import { chatContext } from "../../agenda/chatTools";
import { currentChatFacts } from "../../facts/FactStore";
import { CHAT_SKILLS } from "../../skills";
import { requestPreferences } from "../../preferences/ChatPreferences";
import { CHAT_INSTRUCTIONS_LIMIT, loadChatInstructions, saveChatInstructions } from "../../preferences/ChatInstructions";
import { ChatRequestDetails } from "./ChatRequestDetails";
import { loadDeveloperMode, saveDeveloperMode } from "../../preferences/DeveloperMode";
import { loadReadLinks, saveReadLinks } from "../../preferences/ReadLinkPreferences";
import { moveRadioChoice } from "./radioKeys";
import type { SettingsSection } from "./sections";

const LENGTHS: readonly [ChatPreferences["length"], string][] = [["short", "简短"], ["normal", "自然"]];

/** A failed key action in words the user can act on; the raw error goes to the log. */
export function deepSeekProblem(reason: unknown, doing: string): string {
  const text = String(reason);
  console.error(`DeepSeek ${doing} failed`, reason);
  if (text.includes("格式")) return text.replace(/^Error:\s*/, "");
  const kind = classifyServiceError(text);
  return kind === "other" ? `${doing}失败，请再试一次。` : serviceErrorMessage("DeepSeek", kind);
}

export function AISettings({ packId, persona, name, actions, onOpen, onDeveloperChange }: { packId: string; persona?: PetPersona; name?: string; actions: string[]; onOpen: (section: SettingsSection) => void; onDeveloperChange: (enabled: boolean) => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [preferences, setPreferences] = useState(() => loadChatPreferences(packId, persona));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [instructions, setInstructions] = useState(() => loadChatInstructions(packId));
  const [preview, setPreview] = useState<ChatPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [connectionExpanded, setConnectionExpanded] = useState(false);
  const [developer, setDeveloper] = useState(loadDeveloperMode);
  const [readLinks, setReadLinks] = useState(loadReadLinks);
  const who = name ?? characterName(packId, persona?.name ?? "");
  /** Opened without a key: the key form leads, and stays there after saving so the result does not jump away. */
  const [keyFirst, setKeyFirst] = useState(false);
  useEffect(() => { ai.keyStatus().then((saved) => { setConfigured(saved); setKeyFirst(!saved); }).catch(() => { setConfigured(false); setKeyFirst(true); setStatus("读不到钥匙串，请在 AI Pet 应用里设置。"); }); }, []);
  const needsKey = configured === false;
  useEffect(() => { if (needsKey) setConnectionExpanded(true); }, [needsKey]);
  const updatePreferences = (next: ChatPreferences) => {
    try { saveChatPreferences(packId, next); setPreferences(next); setPreview(null); } catch (reason) { console.error("Could not save chat preferences", reason); setStatus("回复长度没能保存，请再试一次。"); }
  };
  const updateInstructions = (next: string) => {
    try { saveChatInstructions(packId, next); setInstructions(next); setPreview(null); setStatus(""); }
    catch (reason) { console.error("Could not save chat instructions", reason); setStatus("补充要求没能保存，请再试一次。"); }
  };
  const toggleDeveloper = () => {
    try { saveDeveloperMode(!developer); setDeveloper(!developer); onDeveloperChange(!developer); } catch (reason) { console.error("Could not save developer mode", reason); setStatus("设置没能保存，请再试一次。"); }
  };
  const toggleReadLinks = () => {
    try { saveReadLinks(!readLinks); setReadLinks(!readLinks); }
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
    {connectionExpanded && <div className="ai-connection-form ai-settings"><form onSubmit={(event) => void save(event)}><label htmlFor="deepseek-key">API Key</label><div className="ai-settings__key"><input id="deepseek-key" type="password" autoComplete="off" autoFocus={needsKey} value={key} onChange={(event) => setKey(event.currentTarget.value)} placeholder={configured ? "输入新的 API Key 以替换" : "粘贴 DeepSeek API Key"} /><button type="submit" disabled={busy || !key.trim()}>保存</button></div></form><p>保存后会自动测试一次。DeepSeek 按用量收费。</p><div className="ai-settings__actions"><button type="button" disabled={busy || !configured} onClick={() => void test()}>测试连接</button><ConfirmButton disabled={busy || !configured} confirm={{ message: "移除 DeepSeek API Key？", detail: "API Key 会从钥匙串里删掉，之后要重新填写才能聊天。", action: "移除" }} onConfirm={() => void clear()}>移除 API Key</ConfirmButton><button type="button" className="ai-settings__link" onClick={() => void ai.openKeyPage().catch((error: unknown) => { console.error("Could not open the DeepSeek page", error); setStatus("没能打开网页，可以自己在浏览器里打开 platform.deepseek.com。"); })}>获取 API Key</button></div></div>}</div>
    {status && <p className="ai-inline-status" role="status">{status}</p>}
    <div className="ai-model"><ModelSettings keyConfigured={configured} /></div>
    <div className="settings-group ai-model">
      <div className="settings-row">
        <div className="settings-row__body"><strong>自动阅读网页链接</strong><span>在完整聊天里发送网页链接时，交给 DeepSeek 阅读</span></div>
        <button type="button" role="switch" aria-label="自动阅读网页链接" aria-checked={readLinks} className={readLinks ? "toggle is-on" : "toggle"} onClick={toggleReadLinks}><span /></button>
      </div>
    </div>
  </section>;

  return <div className="settings-section ai-page">
    {needsKey && <div className="ai-page__intro"><p>填上 DeepSeek API Key，{who}就能和你聊天。</p></div>}

    {keyFirst && connection}
    <section className="ai-section" aria-labelledby="ai-replies-heading">
      <div className="ai-section__title"><h2 id="ai-replies-heading">回复方式</h2><p>只对{who}生效</p></div>
      <div className="settings-group ai-reply-settings">
        <div className="settings-row"><div className="settings-row__body"><strong>性格</strong><span>{preferences.personality || "还没有设置性格"}</span></div><button type="button" className="settings-button settings-button--small" onClick={() => onOpen("character")}>编辑性格</button></div>
        <div className="settings-row"><div className="settings-row__body"><strong>回复长度</strong><span>简短适合闲聊，自然会多解释几句</span></div><div className="segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="回复长度">{LENGTHS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={preferences.length === value} className={preferences.length === value ? "is-selected" : ""} onClick={() => updatePreferences({ ...preferences, length: value })}>{label}</button>)}</div></div>
        <div className="ai-instructions"><label htmlFor="chat-instructions">补充要求</label><textarea id="chat-instructions" value={instructions} maxLength={CHAT_INSTRUCTIONS_LIMIT} placeholder="例如：聊天时简短一些，讨论技术问题时可以详细解释。" onChange={(event) => updateInstructions(event.currentTarget.value)} /><div className="ai-instructions__foot"><span>自动保存</span><span>{instructions.length} / {CHAT_INSTRUCTIONS_LIMIT}</span></div></div>
      </div>
    </section>
    {!keyFirst && connection}

    <section className="ai-section ai-advanced" aria-labelledby="ai-advanced-heading">
      <div className="ai-section__title"><h2 id="ai-advanced-heading">发给 AI 的设定</h2><p>发出去的全部内容见「隐私与数据」</p></div>
      <div className="settings-card ai-preview"><div className="ai-preview__head"><div><strong>对话规则</strong><span>每次聊天都会带上，可以逐段修改，所有角色共用</span></div><button type="button" className="settings-button settings-button--small" onClick={() => void showPreview()}>{preview ? "刷新" : "查看和修改"}</button></div>{previewError && <p role="status">{previewError}</p>}{preview && <ChatRequestDetails preview={preview} onChanged={() => void showPreview()} onError={setPreviewError} />}</div>
      <div className="settings-group ai-developer"><div className="settings-row"><div className="settings-row__body"><strong>开发者模式</strong><span>{developer ? "已打开：侧栏最下面的「开发者」里能看每次实际发给 AI 的内容" : "记下每次聊天实际发给 AI 的内容和 AI 的原始回复"}</span></div>{developer && <button type="button" className="settings-button settings-button--small" onClick={() => onOpen("developer")}>查看请求</button>}<button type="button" role="switch" aria-label="开发者模式" aria-checked={developer} className={developer ? "toggle is-on" : "toggle"} onClick={toggleDeveloper}><span /></button></div></div>
    </section>

    <div className="settings-group"><div className="settings-row"><div className="settings-row__body"><strong>能帮你做什么</strong><span>{who}能记提醒和备忘、记住你的事、做动作，用平常的话说就行</span></div><button type="button" className="settings-button settings-button--small" onClick={() => onOpen("guide")}>功能一览</button></div></div>
  </div>;
}
