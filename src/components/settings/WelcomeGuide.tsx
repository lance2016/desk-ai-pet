import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ai } from "../../ai";
import { loadChatModel } from "../../preferences/ChatModel";
import { petWindow } from "../../platform/petWindow";
import { loadQuickChatShortcut, quickChatShortcutLabel } from "../../preferences/QuickChatPreferences";
import { loadUserProfile, markOnboarded, saveUserProfile, USER_PROFILE_LIMITS } from "../../preferences/UserProfile";
import { CharacterAvatar } from "../CharacterAvatar";
import { isComposing } from "../keyboard";
import { deepSeekProblem } from "./AISettings";

interface Props {
  /** The current character's name, as the user sees it. */
  name: string;
  avatar: { src: string; fromAction: boolean } | null;
  /** `withoutKey`: the guide ended with no working key, so settings can show where to add one. */
  onClose: (withoutKey: boolean) => void;
}

const STEPS = ["称呼", "连接 AI", "完成"] as const;
const FOCUSABLE = "button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex='-1'])";

/** First-run guide: how to address the user, the DeepSeek key (checked for real), then how to talk to the pet. */
export function WelcomeGuide({ name, avatar, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [nickname, setNickname] = useState(() => loadUserProfile().nickname);
  const [key, setKey] = useState("");
  /** Whether a key is saved and answered: null while unknown. */
  const [keyWorks, setKeyWorks] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => { ai.keyStatus().then((saved) => setKeyWorks(saved ? true : null)).catch(() => {}); }, []);

  /** A message belongs to the step that showed it. */
  const goTo = (next: number) => { setStatus(""); setStep(next); };
  const openKeyPage = () => void ai.openKeyPage().catch(() => setStatus("没能打开网页，可以自己在浏览器里打开 platform.deepseek.com。"));
  const finish = (chat: boolean) => {
    markOnboarded();
    onClose(keyWorks !== true);
    if (chat) void petWindow.openChat().catch((reason: unknown) => console.warn("Could not open the chat", reason));
  };
  const saveName = (event: FormEvent) => {
    event.preventDefault();
    try { saveUserProfile({ nickname }); setStatus(""); setStep(1); }
    catch (reason) { console.error("Could not save the nickname", reason); setStatus(nickname.trim().length > USER_PROFILE_LIMITS.nickname ? `称呼最多 ${USER_PROFILE_LIMITS.nickname} 个字。` : "称呼没能保存，请再试一次。"); }
  };
  /** Saves the key, then sends one tiny request to see whether it really works. */
  const saveKey = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim()) return;
    setBusy(true); setStatus("");
    try { await ai.saveKey(key); setKey(""); }
    catch (reason) { setStatus(deepSeekProblem(reason, "保存")); setBusy(false); return; }
    setStatus("正在试着连一下 DeepSeek…");
    try { await ai.test(loadChatModel()); setKeyWorks(true); setStatus(""); setStep(2); }
    catch (reason) { setKeyWorks(false); setStatus(deepSeekProblem(reason, "连接")); }
    finally { setBusy(false); }
  };
  /** Esc skips the guide; Tab stays inside it. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { if (!isComposing(event)) { event.preventDefault(); finish(false); } return; }
    if (event.key !== "Tab" || !card.current) return;
    const items = [...card.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const called = nickname.trim();
  const shortcut = loadQuickChatShortcut();

  return <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" onKeyDown={onKeyDown}>
    <div ref={card} className="welcome__card">
      {step < 2 && <button type="button" className="welcome__skip" onClick={() => finish(false)} title="之后可以在「设置 → AI 服务」里填 API Key">跳过</button>}
      <CharacterAvatar picture={avatar} className="welcome__avatar" />
      <ol className="welcome__steps" aria-label="引导步骤">{STEPS.map((label, index) => <li key={label} className={index === step ? "is-current" : index < step ? "is-done" : undefined}>{label}</li>)}</ol>

      {step === 0 && <form onSubmit={saveName}>
        <h2 id="welcome-title">你好，我是{name}！</h2>
        <p>以后我会陪在你的桌面上。我该怎么称呼你？</p>
        <input value={nickname} maxLength={USER_PROFILE_LIMITS.nickname} autoFocus placeholder="比如：阿龙。留空也可以" onChange={(event) => setNickname(event.currentTarget.value)} />
        <div className="welcome__actions"><button type="submit" className="is-primary">下一步</button></div>
      </form>}

      {step === 1 && <form onSubmit={(event) => void saveKey(event)}>
        <h2 id="welcome-title">{keyWorks ? "已经连上 AI 了" : "连上 AI，我就能和你聊天"}</h2>
        {keyWorks
          ? <p>DeepSeek API Key 已经配置好，可以直接下一步。</p>
          : <>
            <p>聊天用的是 DeepSeek，需要你自己的 API Key。它在本机加密保存，供模型请求使用。</p>
            <ol className="welcome__howto">
              <li>打开 <button type="button" className="welcome__link" onClick={openKeyPage}>DeepSeek 开放平台 ↗</button>，注册并登录</li>
              <li>充值一点余额（聊天花费很少）</li>
              <li>在「API Keys」里新建一个 API Key，复制下来</li>
              <li>粘贴到下面，点「保存」</li>
            </ol>
            <input type="password" autoComplete="off" value={key} autoFocus placeholder="粘贴 DeepSeek API Key，一般以 sk- 开头" onChange={(event) => setKey(event.currentTarget.value)} />
            <p className="welcome__note">保存后会发一条很短的消息试试能不能连上，费用极少。</p>
          </>}
        <div className="welcome__actions">
          <button type="button" onClick={() => goTo(0)}>上一步</button>
          {keyWorks ? <button type="button" className="is-primary" onClick={() => goTo(2)}>下一步</button>
            : <><button type="button" onClick={() => goTo(2)}>稍后再说</button><button type="submit" className="is-primary" disabled={busy || !key.trim()}>{busy ? "正在保存…" : "保存"}</button></>}
        </div>
      </form>}

      {step === 2 && <div>
        <h2 id="welcome-title">{called ? `准备好啦，${called}！` : "准备好啦！"}</h2>
        {keyWorks
          ? <ul className="welcome__tips">
            <li><strong>点我头旁边的小气泡</strong>就能聊天，脚下会出现输入框</li>
            {shortcut && <li>在任何应用里按 <kbd>{quickChatShortcutLabel(shortcut)}</kbd> 也能叫我</li>}
            <li><strong>右键我</strong>可以打开设置，也能退出</li>
          </ul>
          : <p>填上 DeepSeek API Key，就能和{name}聊天。右键{name}可以打开设置，也能退出。</p>}
        <div className="welcome__actions">
          {keyWorks
            ? <><button type="button" onClick={() => finish(false)}>看看其他设置</button><button type="button" className="is-primary" onClick={() => finish(true)}>开始聊天</button></>
            : <button type="button" className="is-primary" onClick={() => finish(false)}>去填 API Key</button>}
        </div>
      </div>}

      {status && <p className="welcome__status" role="status">{status}</p>}
    </div>
  </div>;
}
