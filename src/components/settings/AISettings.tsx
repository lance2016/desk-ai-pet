import { useEffect, useState, type FormEvent } from "react";
import type { PetPersona } from "../../assets/Manifest";
import { characterName, loadChatPreferences, saveChatPreferences, type ChatPreferences } from "../../preferences/ChatPreferences";
import { loadAutoTitles, saveAutoTitles } from "../../chat/ChatThreads";
import { classifyServiceError, serviceErrorMessage } from "../../chat/serviceErrors";
import { chatPlatform } from "../../platform/chat";
import { ConfirmButton } from "../ConfirmButton";

const LENGTHS: readonly [ChatPreferences["length"], string][] = [["short", "简短"], ["normal", "自然"]];

/** A failed key action in words the user can act on; the raw error goes to the log. */
export function deepSeekProblem(reason: unknown, doing: string): string {
  const text = String(reason);
  console.error(`DeepSeek ${doing} failed`, reason);
  if (text.includes("格式")) return text.replace(/^Error:\s*/, "");
  const kind = classifyServiceError(text);
  return kind === "other" ? `${doing}失败，请再试一次。` : serviceErrorMessage("DeepSeek", kind);
}

export function AISettings({ packId, persona, name }: { packId: string; persona?: PetPersona; name?: string }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState("");
  const [preferences, setPreferences] = useState(() => loadChatPreferences(packId, persona));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [autoTitles, setAutoTitles] = useState(loadAutoTitles);
  const who = name ?? characterName(packId, persona?.name ?? "");
  const toggleAutoTitles = () => {
    try { saveAutoTitles(!autoTitles); setAutoTitles(!autoTitles); } catch (reason) { console.error("Could not save the title setting", reason); setStatus("设置没能保存，请再试一次。"); }
  };
  useEffect(() => { chatPlatform.keyStatus().then(setConfigured).catch(() => { setConfigured(false); setStatus("读不到钥匙串，请在 AI Pet 应用里设置。"); }); }, []);
  const updatePreferences = (next: ChatPreferences) => {
    setPreferences(next);
    try { saveChatPreferences(packId, next); } catch (reason) { console.error("Could not save chat preferences", reason); setStatus("回复长度没能保存，请再试一次。"); }
  };
  const test = async () => {
    setBusy(true); setStatus("正在测试连接…");
    try { await chatPlatform.test(); setStatus("连接成功，可以开始聊天了。"); }
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
  return <div className="settings-section"><div className="settings-section__intro"><h2>DeepSeek 对话</h2><p>填上 API Key 后，就可以和宠物聊天、让它记提醒和备忘。</p></div>
    <article className="settings-card ai-settings"><div className="ai-settings__head"><div><strong>DeepSeek API Key</strong><span>在 DeepSeek 开放平台注册、充值后新建</span></div><span className={configured ? "ai-badge is-ready" : "ai-badge"}>{configured === null ? "检查中" : configured ? "已配置" : "未配置"}</span></div>
      <form onSubmit={(event) => void save(event)}><label htmlFor="deepseek-key">API Key</label><div className="ai-settings__key"><input id="deepseek-key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.currentTarget.value)} placeholder={configured ? "输入新的 API Key 以替换" : "粘贴 DeepSeek API Key，一般以 sk- 开头"} /><button type="submit" disabled={busy || !key.trim()}>保存</button></div></form>
      <p>API Key 存在钥匙串里，聊天内容会发给 DeepSeek，使用会产生 API 费用。保存和测试连接时会发一条很短的消息，费用极少。</p><div className="ai-settings__actions"><button type="button" disabled={busy || !configured} onClick={() => void test()}>测试连接</button><ConfirmButton disabled={busy || !configured} confirmLabel="再点一次移除" onConfirm={() => void clear()}>移除 API Key</ConfirmButton><button type="button" className="ai-settings__link" onClick={() => void chatPlatform.openKeyPage().catch((error: unknown) => { console.error("Could not open the DeepSeek page", error); setStatus("没能打开网页，可以自己在浏览器里打开 platform.deepseek.com。"); })}>获取 API Key ↗</button></div>{status && <p className="ai-settings__status" role="status">{status}</p>}</article>
    <div className="settings-section__intro settings-section__intro--spaced"><h2>回复方式 · {who}</h2><p>只属于当前角色。名字和性格在「角色」页修改。</p></div>
    <div className="settings-group"><div className="settings-row"><div className="settings-row__body"><strong>回复长度</strong><span>「简短」更像聊天，「自然」会按内容多说一些</span></div><div className="segmented" role="radiogroup" aria-label="回复长度">{LENGTHS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={preferences.length === value} className={preferences.length === value ? "is-selected" : ""} onClick={() => updatePreferences({ ...preferences, length: value })}>{label}</button>)}</div></div></div>
    <div className="settings-section__intro settings-section__intro--spaced"><h2>聊天记录</h2><p>对所有角色生效。</p></div>
    <article className="settings-card"><div className="voice-toggle voice-toggle--first"><div><strong>自动生成聊天标题</strong><span>第一轮回复后，请 AI 用一句短语概括这段聊天，会多一次很小的 API 调用。关闭后用你说的第一句话做标题。</span></div><button type="button" role="switch" aria-label="自动生成聊天标题" aria-checked={autoTitles} className={autoTitles ? "toggle is-on" : "toggle"} onClick={toggleAutoTitles}><span /></button></div></article>
    <p className="settings-footnote">聊天记录只存在这台电脑上，可以在聊天窗口的「聊天记录」里删除。</p></div>;
}
