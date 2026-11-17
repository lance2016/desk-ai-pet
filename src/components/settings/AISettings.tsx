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
  const who = name ?? characterName(packId, persona?.name ?? "");
  const toggleAutoTitles = () => {
    try { saveAutoTitles(!autoTitles); setAutoTitles(!autoTitles); } catch (reason) { console.error("Could not save the title setting", reason); setStatus("设置没能保存，请再试一次。"); }
  };
  useEffect(() => { chatPlatform.keyStatus().then(setConfigured).catch(() => { setConfigured(false); setStatus("读不到钥匙串，请在 AI Pet 应用里设置。"); }); }, []);
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
  return <div className="settings-section">
    <div className="settings-section__intro">
      <h2>连接</h2>
      <p>连接 DeepSeek 后，可以聊天、记事，也能让宠物做动作。</p>
    </div>
    <article className="settings-card ai-settings">
      <div className="ai-settings__head">
        <div><strong>DeepSeek API Key</strong><span>在 DeepSeek 开放平台注册并创建</span></div>
        <span className={configured ? "ai-badge is-ready" : "ai-badge"}>{configured === null ? "检查中" : configured ? "已配置" : "未配置"}</span>
      </div>
      <form onSubmit={(event) => void save(event)}>
        <label htmlFor="deepseek-key">API Key</label>
        <div className="ai-settings__key">
          <input id="deepseek-key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.currentTarget.value)} placeholder={configured ? "输入新的 API Key 以替换" : "粘贴 DeepSeek API Key"} />
          <button type="submit" disabled={busy || !key.trim()}>保存</button>
        </div>
      </form>
      <p>API Key 保存在钥匙串。聊天内容会发送给 DeepSeek，服务商可能收费。保存后会自动测试连接；单独测试也会发送一条简短请求。</p>
      <div className="ai-settings__actions">
        <button type="button" disabled={busy || !configured} onClick={() => void test()}>测试连接</button>
        <ConfirmButton disabled={busy || !configured} confirmLabel="再点一次移除" onConfirm={() => void clear()}>移除 API Key</ConfirmButton>
        <button type="button" className="ai-settings__link" onClick={() => void chatPlatform.openKeyPage().catch((error: unknown) => { console.error("Could not open the DeepSeek page", error); setStatus("没能打开网页，可以自己在浏览器里打开 platform.deepseek.com。"); })}>获取 API Key ↗</button>
      </div>
      {status && <p className="ai-settings__status" role="status">{status}</p>}
    </article>

    <div className="settings-section__intro settings-section__intro--spaced">
      <h2>回复模型</h2>
      <p>所有角色共用，用于聊天、问候和自动生成的标题。</p>
    </div>
    <ModelSettings keyConfigured={configured} />

    <div className="settings-section__intro settings-section__intro--spaced">
      <h2>{who}的回复偏好</h2>
      <p>只影响当前角色。名字和性格可以在「角色」页调整。</p>
    </div>
    <div className="settings-group">
      <div className="settings-row"><div className="settings-row__body"><strong>角色性格</strong><span>{preferences.personality || "还没有设置性格"}</span></div><button type="button" className="settings-button settings-button--small" onClick={onCharacter}>前往角色设置</button></div>
      <div className="settings-row">
        <div className="settings-row__body">
          <strong>回复长度</strong>
          <span>简短适合日常聊天；自然会根据问题补充细节</span>
        </div>
        <div className="segmented" role="radiogroup" aria-label="回复长度">
          {LENGTHS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={preferences.length === value} className={preferences.length === value ? "is-selected" : ""} onClick={() => updatePreferences({ ...preferences, length: value })}>{label}</button>)}
        </div>
      </div>
    </div>

    <div className="ai-instructions settings-card">
      <label htmlFor="chat-instructions">补充要求</label>
      <p>告诉{who}你喜欢怎样的回复。只影响这个角色的聊天，应用规则仍然生效。</p>
      <textarea id="chat-instructions" value={instructions} maxLength={CHAT_INSTRUCTIONS_LIMIT} placeholder="例如：回答尽量简短，讨论技术问题时可以详细一些。" onChange={(event) => updateInstructions(event.currentTarget.value)} />
      <div className="ai-instructions__foot"><span>不影响早晚问候和聊天标题</span><span>{instructions.length} / {CHAT_INSTRUCTIONS_LIMIT}</span></div>
    </div>

    <div className="settings-section__intro settings-section__intro--spaced"><h2>{who}能做什么</h2><p>聊天时可以尝试这样说；具体操作由 AI 判断。</p></div>
    <div className="settings-group ai-capabilities">
      <div className="settings-row"><div className="settings-row__body"><strong>创建提醒</strong><span>“每个工作日 11 点提醒我点外卖”</span></div><span className="settings-row__value">支持重复提醒</span></div>
      <div className="settings-row"><div className="settings-row__body"><strong>保存备忘</strong><span>“帮我记一下，下次买咖啡豆”</span></div></div>
      <div className="settings-row"><div className="settings-row__body"><strong>做动作</strong><span>“挥挥手”或根据对话做出反应</span></div></div>
    </div>
    <p className="settings-footnote">目前只能新建提醒和备忘，不能通过聊天查看、修改或删除已有内容。动作是否播放取决于当前状态和可用素材。</p>

    <div className="settings-section__intro settings-section__intro--spaced"><h2>提示词与工具</h2><p>查看聊天时组装的系统提示词和工具定义。</p></div>
    <div className="settings-card ai-preview">
      <div className="ai-preview__head"><div><strong>聊天请求预览</strong><span>根据当前角色和时间生成，不发送请求，也不包含聊天记录。</span></div><button type="button" className="settings-button settings-button--small" onClick={() => void showPreview()}>{preview ? "刷新预览" : "查看预览"}</button></div>
      {previewError && <p role="status">{previewError}</p>}
      {preview && <div className="ai-preview__body"><p>这是当前配置的预览；真正聊天时的时间和可用动作可能不同。</p><details open><summary>系统提示词</summary><pre>{preview.prompt}</pre></details><details><summary>工具定义（{preview.tools.length}）</summary><pre>{JSON.stringify(preview.tools, null, 2)}</pre></details></div>}
    </div>

    <div className="settings-section__intro settings-section__intro--spaced">
      <h2>聊天记录与数据</h2>
      <p>自动标题对所有角色生效；聊天记录按角色分别保存。</p>
    </div>
    <article className="settings-card">
      <div className="voice-toggle voice-toggle--first">
        <div>
          <strong>自动生成聊天标题</strong>
          <span>新聊天收到第一条回复后，AI 会额外生成一个标题，会多一次 API 请求。关闭后使用你发出的第一句话。</span>
        </div>
        <button type="button" role="switch" aria-label="自动生成聊天标题" aria-checked={autoTitles} className={autoTitles ? "toggle is-on" : "toggle"} onClick={toggleAutoTitles}><span /></button>
      </div>
    </article>
    <details className="settings-card ai-data-details">
      <summary>AI 会收到哪些内容？</summary>
      <div className="ai-data-details__content">
        <p><strong>对话：</strong>当前聊天最近最多 30 条消息，包含本次发送的消息。</p>
        <p><strong>角色和时间：</strong>角色名称、性格、聊天补充要求、你设置的称呼（如有）、当前日期和未来几天的日期。</p>
        <p><strong>可用操作：</strong>新建提醒、保存备忘，以及当前角色可做的动作。本机已有的提醒和备忘清单不会整体附带给 AI；出现在最近聊天中的文字仍会随上下文发送。</p>
        <p><strong>系统规则：</strong>应用会附带日期处理和工具使用规则。角色性格可在「角色」页调整，底层规则由应用维护。</p>
        <p><strong>API Key：</strong>保存在钥匙串，用于 DeepSeek 请求认证，不会作为聊天消息内容发送。</p>
      </div>
    </details>
    <p className="settings-footnote">聊天记录只保存在这台电脑，支持在聊天窗口查看、改名或删除。每个角色最多保留 20 段，超出后会删除最早的记录。</p>
  </div>;
}
