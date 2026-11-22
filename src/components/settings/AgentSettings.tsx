import { useCallback, useEffect, useState } from "react";
import { agentPlatform, type ClaudeHooksState } from "../../platform/agents";
import { loadCodingReactions, saveCodingReactions } from "../../preferences/CodingPreferences";
import { ConfirmButton } from "../ConfirmButton";

const HAS_CHINESE = /[一-鿿]/;

/** The native side words its errors for the user; anything else is logged and replaced. */
function failure(reason: unknown, doing: string): string {
  console.error(`Claude Code hooks: ${doing} failed`, reason);
  const text = String(reason).replace(/^Error:\s*/, "");
  return HAS_CHINESE.test(text) ? text : `${doing}失败，请再试一次`;
}

function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

function describe(state: ClaudeHooksState | undefined, now: number): string {
  if (state === undefined) return "检查中";
  if (!state.connected) return "连上后，宠物脚下会显示每个会话在做什么、哪个在等你";
  if (!state.current) return "AI Pet 换了位置，或新版本多接了事件，重新连接一下才收得全";
  return state.lastReportAt === null ? "已连接，新开的 Claude Code 会话才会报上来" : `已连接，最近一次收到：${ago(state.lastReportAt, now)}`;
}

/** "编码助手" on the "小工具" page: puts the pet's hooks into Claude Code's settings, or takes them out. */
export function AgentSettings() {
  const [state, setState] = useState<ClaudeHooksState | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [reacts, setReacts] = useState(loadCodingReactions);
  const toggleReacts = () => { saveCodingReactions(!reacts); setReacts(!reacts); };
  const refresh = useCallback(() => agentPlatform.state().then(setState).catch((reason: unknown) => setStatus(failure(reason, "读取 Claude Code 设置"))), []);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (change: () => Promise<void>, doing: string, done: string) => {
    setBusy(true); setStatus("");
    try { await change(); setStatus(done); }
    catch (reason) { setStatus(failure(reason, doing)); }
    finally { setBusy(false); void refresh(); }
  };
  const connect = () => void run(agentPlatform.connect, "连接", "已连接。新开的 Claude Code 会话才会报上来，开着的要重开一次");
  const disconnect = () => void run(agentPlatform.disconnect, "断开", "已断开，Claude Code 设置里只去掉了宠物加的那几条");

  const action = !state?.connected || !state.current
    ? (
      <ConfirmButton className="settings-button settings-button--small" disabled={busy || state === undefined} confirm={{
        message: state?.connected ? "重新连接 Claude Code？" : "连接 Claude Code？",
        detail: "会在 ~/.claude/settings.json 里加几条钩子，改之前先备份成 settings.json.ai-pet-backup。钩子在后台运行，不会拖慢 Claude Code。它只把这些交给宠物，都留在这台电脑上：项目名和分支、你每次输入的第一行（当任务名）、工具名和它在改的文件名、Claude 最后一条回复的第一行。命令、代码和工具输出不报。你自己的设置和别的钩子都不动，随时可以断开。",
        action: state?.connected ? "重新连接" : "连接",
      }} onConfirm={connect}>{state?.connected ? "重新连接" : "连接"}</ConfirmButton>
    )
    : <button type="button" className="settings-button settings-button--small" disabled={busy} onClick={disconnect}>断开</button>;

  return <>
    <h2 className="settings-group-title">编码助手</h2>
    <div className="settings-group">
      <div className="settings-row">
        <div className="settings-row__body"><strong>Claude Code</strong><span>{describe(state, Date.now())}</span></div>
        {action}
      </div>
      <div className="settings-row">
        <div className="settings-row__body"><strong>宠物跟着反应</strong><span>有会话等你、做完或出错时，宠物会做动作、说一句。关掉后只在脚下的卡片上显示</span></div>
        <button type="button" role="switch" aria-label="宠物跟着反应" aria-checked={reacts} className={reacts ? "toggle is-on" : "toggle"} onClick={toggleReacts}><span /></button>
      </div>
    </div>
    {status && <p className="settings-footnote" role="status">{status}</p>}
  </>;
}
