import { useState, type FormEvent } from "react";
import { ai } from "../../ai";
import { classifyServiceError } from "../../chat/serviceErrors";
import { CHAT_MODEL_PATTERN, CHAT_MODELS, isBuiltInModel, loadChatModel, saveChatModel } from "../../preferences/ChatModel";
import { deepSeekProblem } from "./AISettings";
import { moveRadioChoice } from "./radioKeys";

const CUSTOM = "custom";

/**
 * Which DeepSeek model answers, for every character. A custom name is tried
 * with one tiny request before it is used, so a typo never breaks the chat.
 */
export function ModelSettings({ keyConfigured }: { keyConfigured: boolean | null }) {
  const [model, setModel] = useState(loadChatModel);
  const [choice, setChoice] = useState(() => (isBuiltInModel(model) ? model : CUSTOM));
  const [draft, setDraft] = useState(() => (isBuiltInModel(model) ? "" : model));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const keep = (next: string, message: string) => {
    try { saveChatModel(next); setModel(next); setStatus(message); }
    catch (reason) { console.error("Could not save the chat model", reason); setStatus("模型没能保存，请再试一次。"); }
  };
  const pickBuiltIn = (id: string) => { setChoice(id); if (id !== model) keep(id, ""); else setStatus(""); };
  const useCustom = async (event: FormEvent) => {
    event.preventDefault();
    const name = draft.trim();
    if (!CHAT_MODEL_PATTERN.test(name)) { setStatus("模型名只能有英文字母、数字和 - _ . : /，最多 64 个字符。"); return; }
    if (!keyConfigured) { keep(name, `已换成 ${name}。填好 API Key 后就用它回复。`); return; }
    setBusy(true); setStatus(`正在用 ${name} 试着连一下…`);
    try { await ai.test(name); keep(name, `已换成 ${name}，连接正常。`); }
    catch (reason) {
      setStatus(classifyServiceError(String(reason)) === "model"
        ? `DeepSeek 不认识「${name}」，检查一下拼写。没有换，还在用 ${model}。`
        : `${deepSeekProblem(reason, "测试")}没有换，还在用 ${model}。`);
    } finally { setBusy(false); }
  };

  const builtIn = CHAT_MODELS.find((item) => item.id === choice);
  const hint = builtIn ? `${builtIn.id}，${builtIn.hint}` : isBuiltInModel(model) ? "填 DeepSeek 开放平台上的模型名，测试通过才会换" : `正在用 ${model}`;
  return <>
    <div className="settings-group">
      <div className="settings-row">
        <div className="settings-row__body"><strong>回复用的模型</strong><span>{hint}</span></div>
        <div className="ui-segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="回复用的模型">
          {CHAT_MODELS.map((item) => <button key={item.id} type="button" role="radio" aria-checked={choice === item.id} className={choice === item.id ? "is-selected" : ""} disabled={busy} onClick={() => pickBuiltIn(item.id)}>{item.label}</button>)}
          <button type="button" role="radio" aria-checked={choice === CUSTOM} className={choice === CUSTOM ? "is-selected" : ""} disabled={busy} onClick={() => { setChoice(CUSTOM); setStatus(""); }}>自定义</button>
        </div>
      </div>
      {choice === CUSTOM && <form className="settings-row model-custom" onSubmit={(event) => void useCustom(event)}>
        <input className="ui-field ui-field--small" aria-label="自定义模型名" value={draft} maxLength={64} spellCheck={false} autoCapitalize="off" autoComplete="off" placeholder="例如：deepseek-chat" onChange={(event) => setDraft(event.currentTarget.value)} />
        <button type="submit" className="ui-button ui-button--small" disabled={busy || !draft.trim() || draft.trim() === model}>{busy ? "测试中…" : "测试并使用"}</button>
      </form>}
    </div>
    {status && <p className="settings-footnote" role="status">{status}</p>}
  </>;
}
