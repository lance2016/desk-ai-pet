import { useEffect, useState, type FormEvent } from "react";
import type { PetPersona } from "../../assets/Manifest";
import { characterName, loadChatPreferences, saveChatPreferences, type ChatPreferences } from "../../preferences/ChatPreferences";
import { loadAutoTitles, saveAutoTitles } from "../../chat/ChatThreads";
import { classifyServiceError, serviceErrorMessage } from "../../chat/serviceErrors";
import { chatPlatform } from "../../platform/chat";
import { loadChatModel } from "../../preferences/ChatModel";
import { ModelSettings } from "./ModelSettings";
import { ConfirmButton } from "../ConfirmButton";
import { chatContext } from "../../agenda/chatTools";
import { requestPreferences } from "../../preferences/ChatPreferences";
import { CHAT_INSTRUCTIONS_LIMIT, loadChatInstructions, saveChatInstructions } from "../../preferences/ChatInstructions";
import type { ChatPreview } from "../../platform/chat";
import { ChatRequestDetails } from "./ChatRequestDetails";
import { moveRadioChoice } from "./radioKeys";

const LENGTHS: readonly [ChatPreferences["length"], string][] = [["short", "简短"], ["normal", "自然"]];

/** A failed key action in words the user can act on; the raw error goes to the log. */
export function deepSeekProblem(reason: unknown, doing: string): string {
  const text = String(reason);
  console.error(`DeepSeek ${doing} failed`, reason);
  if (text.includes("格式")) return text.replace(/^Error:\s*/, "");
  const kind = classifyServiceError(text);
  return kind === "other" ? `${doing}失败，请再试一次。` : serviceErrorMessage("DeepSeek", kind);
}

export function AISettings({ packId, persona, name, actions, onCharacter }: { packId: string; persona?: PetPersona; name?: string; actions: string[]; onCharacter: () => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [preferences, setPreferences] = useState(() => loadChatPreferences(packId, persona));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [autoTitles, setAutoTitles] = useState(loadAutoTitles);
  const [instructions, setInstructions] = useState(() => loadChatInstructions(packId));
  const [preview, setPreview] = useState<ChatPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [connectionExpanded, setConnectionExpanded] = useState(false);
  const who = name ?? characterName(packId, persona?.name ?? "");
  const toggleAutoTitles = () => {
    try { saveAutoTitles(!autoTitles); setAutoTitles(!autoTitles); } catch (reason) { console.error("Could not save the title setting", reason); setStatus("设置没能保存，请再试一次。"); }
  };
  /** Opened without a key: the key form leads, and stays there after saving so the result does not jump away. */
  const [keyFirst, setKeyFirst] = useState(false);
  useEffect(() => { chatPlatform.keyStatus().then((saved) => { setConfigured(saved); setKeyFirst(!saved); }).catch(() => { setConfigured(false); setKeyFirst(true); setStatus("读不到钥匙串，请在 AI Pet 应用里设置。"); }); }, []);
  const needsKey = configured === false;
  useEffect(() => { if (needsKey) setConnectionExpanded(true); }, [needsKey]);
  const updatePreferences = (next: ChatPreferences) => {
    try { saveChatPreferences(packId, next); setPreferences(next); setPreview(null); } catch (reason) { console.error("Could not save chat preferences", reason); setStatus("回复长度没能保存，请再试一次。"); }
  };
  const updateInstructions = (next: string) => {
    try { saveChatInstructions(packId, next); setInstructions(next); setPreview(null); setStatus(""); }
    catch (reason) { console.error("Could not save chat instructions", reason); setStatus("补充要求没能保存，请再试一次。"); }
  };
  const showPreview = async () => {
    setPreviewError("");
    try { setPreview(await chatPlatform.preview(requestPreferences(packId, persona), chatContext(Date.now(), actions))); }
    catch (reason) { console.error("Could not preview chat request", reason); setPreviewError("没能生成预览，请在桌面应用中重试。"); }
  };
  const test = async () => {
    setBusy(true); setStatus("正在测试连接…");
    try { await chatPlatform.test(loadChatModel()); setStatus("连接成功，可以开始聊天了。"); }
    catch (error) { setStatus(deepSeekProblem(error, "测试连接")); }
    finally { setBusy(false); }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!key.trim()) return;
    setBusy(true); setStatus("");
    try { await chatPlatform.saveKey(key); setKey(""); setConfigured(true); }
    catch (error) { setStatus(deepSeekProblem(error, "保存")); setBusy(false); return; }
    setBusy(false);
    await test();
  };
  const clear = async () => {
    setBusy(true); setStatus("");
    try { await chatPlatform.clearKey(); setConfigured(false); setStatus("已移除 API Key。"); }
    catch (error) { setStatus(deepSeekProblem(error, "移除")); }
    finally { setBusy(false); }
  };
  const connection = <section className="ai-section" aria-labelledby="ai-connection-heading">
    <div className="ai-section__title"><h2 id="ai-connection-heading">连接与模型</h2><p>所有角色共用，用于聊天、问候和自动生成标题。</p></div>
    <div className="settings-group ai-connection-row"><div className="settings-row"><div className="settings-row__body"><strong>DeepSeek</strong><span>{configured === null ? "正在检查 API Key" : configured ? "API Key 已保存在钥匙串" : "配置 API Key 后就可以开始聊天"}</span></div><button type="button" className="settings-button settings-button--small" aria-expanded={connectionExpanded} onClick={() => setConnectionExpanded((open) => !open)}>{connectionExpanded ? "收起" : "管理 API Key"}</button></div>
    {connectionExpanded && <div className="ai-connection-form ai-settings"><form onSubmit={(event) => void save(event)}><label htmlFor="deepseek-key">API Key</label><div className="ai-settings__key"><input id="deepseek-key" type="password" autoComplete="off" autoFocus={needsKey} value={key} onChange={(event) => setKey(event.currentTarget.value)} placeholder={configured ? "输入新的 API Key 以替换" : "粘贴 DeepSeek API Key"} /><button type="submit" disabled={busy || !key.trim()}>保存</button></div></form><p>聊天内容会发送给 DeepSeek，服务商可能收费。保存后会自动测试连接；测试会发送一条简短请求。</p><div className="ai-settings__actions"><button type="button" disabled={busy || !configured} onClick={() => void test()}>测试连接</button><ConfirmButton disabled={busy || !configured} confirmLabel="再点一次移除" onConfirm={() => void clear()}>移除 API Key</ConfirmButton><button type="button" className="ai-settings__link" onClick={() => void chatPlatform.openKeyPage().catch((error: unknown) => { console.error("Could not open the DeepSeek page", error); setStatus("没能打开网页，可以自己在浏览器里打开 platform.deepseek.com。"); })}>获取 API Key</button></div></div>}</div>
    {status && <p className="ai-inline-status" role="status">{status}</p>}
    <div className="ai-model"><ModelSettings keyConfigured={configured} /></div>
  </section>;

  return <div className="settings-section ai-page">
    <div className="ai-page__intro">
      <p>{needsKey ? `填上 DeepSeek API Key，${who}就能和你聊天。` : `调整${who}的回复方式，了解聊天时能帮你做什么。`}</p>
      <div className="ai-connection-status"><span className={configured ? "ai-status-dot is-ready" : "ai-status-dot"} /><span>{configured === null ? "正在检查连接" : configured ? "DeepSeek 已配置" : "尚未配置 DeepSeek"}</span>{!needsKey && <button type="button" onClick={() => setConnectionExpanded((open) => !open)}>{connectionExpanded ? "收起连接设置" : "管理连接"}</button>}</div>
    </div>

    <div className="ai-layout">
      <div className="ai-layout__main">
        {keyFirst && connection}
        <section className="ai-section" aria-labelledby="ai-replies-heading">
          <div className="ai-section__title"><h2 id="ai-replies-heading">回复方式</h2><p>只影响当前角色，换个角色可以单独设置。</p></div>
          <div className="settings-group ai-reply-settings">
            <div className="settings-row"><div className="settings-row__body"><strong>性格</strong><span>{preferences.personality || "还没有设置性格"}</span></div><button type="button" className="settings-button settings-button--small" onClick={onCharacter}>编辑性格</button></div>
            <div className="settings-row"><div className="settings-row__body"><strong>回复长度</strong><span>简短适合日常聊天；自然会按问题补充细节</span></div><div className="segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="回复长度">{LENGTHS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={preferences.length === value} className={preferences.length === value ? "is-selected" : ""} onClick={() => updatePreferences({ ...preferences, length: value })}>{label}</button>)}</div></div>
            <div className="ai-instructions"><label htmlFor="chat-instructions">对回复的补充要求</label><p>还想让{who}怎么和你交流？写下你的偏好。</p><textarea id="chat-instructions" value={instructions} maxLength={CHAT_INSTRUCTIONS_LIMIT} placeholder="例如：聊天时简短一些，讨论技术问题时可以详细解释。" onChange={(event) => updateInstructions(event.currentTarget.value)} /><div className="ai-instructions__foot"><span>自动保存，仅用于这个角色的聊天</span><span>{instructions.length} / {CHAT_INSTRUCTIONS_LIMIT}</span></div></div>
          </div>
        </section>

        {!keyFirst && connection}
      </div>

      <div className="ai-layout__aside">
        <section className="ai-section" aria-labelledby="ai-capabilities-heading">
          <div className="ai-section__title"><h2 id="ai-capabilities-heading">{who}能帮你做什么</h2><p>试着直接告诉{who}，不需要记住指令。</p></div>
          <div className="ai-capability-list">
            <div className="ai-capability"><span className="ai-capability__icon" aria-hidden="true">◷</span><div><strong>创建提醒</strong><p>“每个工作日 11 点提醒我点外卖”</p><small>支持单次和重复提醒</small></div></div>
            <div className="ai-capability"><span className="ai-capability__icon" aria-hidden="true">✎</span><div><strong>保存备忘</strong><p>“帮我记一下，下次买咖啡豆”</p><small>没有指定时间的内容会存进备忘</small></div></div>
            <div className="ai-capability"><span className="ai-capability__icon" aria-hidden="true">✦</span><div><strong>做动作</strong><p>“挥挥手”</p><small>也可能根据聊天内容做出反应</small></div></div>
          </div>
          <p className="settings-footnote">目前只能新建提醒和备忘，不能通过聊天查看、修改或删除已有内容。动作是否播放取决于当前状态和可用素材。</p>
        </section>

        <section className="ai-section" aria-labelledby="ai-data-heading">
          <div className="ai-section__title"><h2 id="ai-data-heading">聊天与数据</h2></div>
          <div className="settings-group"><div className="settings-row"><div className="settings-row__body"><strong>自动生成聊天标题</strong><span>首次回复后额外调用一次 AI；关闭后使用你发出的第一句话。</span></div><button type="button" role="switch" aria-label="自动生成聊天标题" aria-checked={autoTitles} className={autoTitles ? "toggle is-on" : "toggle"} onClick={toggleAutoTitles}><span /></button></div></div>
          <details className="ai-disclosure ai-disclosure--standalone"><summary><span><strong>聊天时会发送什么？</strong><small>了解对话内容和数据的使用方式</small></span></summary><div className="ai-data-copy"><p>聊天会把当前对话最近最多 30 条消息、角色名字和性格、你的称呼、补充要求、当前时间和可用动作发送给 DeepSeek。</p><p>已有提醒和备忘不会整体发送；如果它们出现在最近聊天记录中，相关文字仍会随聊天发送。API Key 保存在钥匙串，不作为聊天内容发送。</p><p>聊天记录保存在这台电脑，按角色分别保存；每个角色最多保留 20 段，超出后删除最早的记录。</p></div></details>
        </section>
      </div>
    </div>

    <section className="ai-section ai-advanced" aria-labelledby="ai-advanced-heading"><div className="ai-section__title"><h2 id="ai-advanced-heading">了解 AI 如何工作</h2><p>想更深入了解时，可以查看实际提供给 AI 的对话规则和能力。</p></div><div className="settings-card ai-preview"><div className="ai-preview__head"><div><strong>聊天规则与能力详情</strong><span>按当前设置生成，不发送请求，也不包含聊天记录。</span></div><button type="button" className="settings-button settings-button--small" onClick={() => void showPreview()}>{preview ? "刷新" : "查看详情"}</button></div>{previewError && <p role="status">{previewError}</p>}{preview && <ChatRequestDetails preview={preview} />}</div></section>
  </div>;
}
