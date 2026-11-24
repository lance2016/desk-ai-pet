import { useCallback, useEffect, useState } from "react";
import { ai, type ChatRequestLog as Log } from "../../ai";
import { z } from "zod";
import { ConfirmButton } from "../ConfirmButton";

const bodySchema = z.object({
  model: z.string(),
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
  tools: z.array(z.object({ function: z.object({ name: z.string() }) })).optional(),
});
const ROLES: Record<string, string> = { system: "系统提示词", user: "用户", assistant: "宠物" };
const WINDOWS: Record<string, string> = { chat: "聊天窗口", main: "快速聊天" };
const COPIED_MS = 1_500;
const time = (at: number) => new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

type Entry = Log[number];
type Round = Entry["rounds"][number];

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;

/** "用时 3.2 秒，首字 0.8 秒，输入 900 token（缓存命中 640），输出 12 token". */
function costText(round: Round): string {
  const parts = [`用时 ${seconds(round.durationMs)}`];
  if (round.firstTokenMs !== null) parts.push(`首字 ${seconds(round.firstTokenMs)}`);
  if (round.usage) {
    const cached = round.usage.cacheHitTokens ? `（缓存命中 ${round.usage.cacheHitTokens}）` : "";
    parts.push(`输入 ${round.usage.promptTokens} token${cached}`, `输出 ${round.usage.completionTokens} token`);
  }
  return parts.join("，");
}

/** One request as sent, and what came back for it. */
function RoundView({ round, index }: { round: Round; index: number }) {
  const body = bodySchema.safeParse(round.request);
  const outcome = round.ok ? "成功" : round.status ? `失败（HTTP ${round.status}）` : "失败";
  return <section className="ai-log-round">
    <h4>第 {index + 1} 次请求<span>{body.success ? body.data.model : ""} {outcome}</span></h4>
    <p className="ai-log-cost">{costText(round)}</p>
    {body.success ? <>
      {body.data.messages.map((message, at) => <div key={at} className="ai-log-message"><span>{ROLES[message.role] ?? message.role}</span><pre>{message.content}</pre></div>)}
      <p className="ai-log-tools">可用工具：{body.data.tools?.map((tool) => tool.function.name).join("、") || "无"}</p>
    </> : <pre>{JSON.stringify(round.request, null, 2)}</pre>}
    <div className="ai-log-message is-reply"><span>模型原样返回</span><pre>{round.reply || "（没有文字）"}</pre></div>
    {round.toolCalls.length > 0 && <div className="ai-log-message is-reply"><span>工具调用</span><pre>{round.toolCalls.map((call) => `${call.name} ${call.arguments}`).join("\n")}</pre></div>}
  </section>;
}

function EntryView({ entry }: { entry: Entry }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), COPIED_MS); return () => clearTimeout(timer); }, [copied]);
  const first = bodySchema.safeParse(entry.rounds[0]?.request);
  const asked = first.success ? first.data.messages.filter((message) => message.role === "user").pop()?.content : undefined;
  const copy = () => void navigator.clipboard.writeText(JSON.stringify(entry, null, 2)).then(() => setCopied(true)).catch((reason: unknown) => console.error("Could not copy the request", reason));
  return <details className="ai-disclosure">
    <summary><span><strong>{time(entry.at)} {WINDOWS[entry.window] ?? entry.window}</strong><small>{asked ? `“${asked.slice(0, 40)}”，` : ""}请求了 {entry.rounds.length} 次</small></span></summary>
    {entry.rounds.length === 0 ? <p className="ai-log-empty">还在回复，稍后刷新。</p> : entry.rounds.map((round, index) => <RoundView key={index} round={round} index={index} />)}
    <div className="ai-log-copy"><button type="button" className="ui-button ui-button--small" onClick={copy}>{copied ? "已复制" : "复制 JSON"}</button></div>
  </details>;
}

/** The chat requests developer mode kept since the app started, newest first. */
export function ChatRequestLog() {
  const [log, setLog] = useState<Log | null>(null);
  const [problem, setProblem] = useState("");
  const refresh = useCallback(() => {
    setProblem("");
    ai.requestLog().then(setLog).catch((reason: unknown) => { console.error("Could not read the request log", reason); setProblem("读不到请求记录，请在桌面应用中重试。"); });
  }, []);
  useEffect(refresh, [refresh]);
  // Chats happen in other windows: look again when settings comes back to the front.
  useEffect(() => { window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [refresh]);
  const clear = () => void ai.clearRequestLog().then(refresh).catch((reason: unknown) => { console.error("Could not clear the request log", reason); setProblem("没能清空，请再试一次。"); });
  return <div className="ai-log">
    <div className="ai-preview__head">
      <div><strong>最近发出的请求</strong><span>只记开发者模式打开以后的聊天，保留最近 100 条，退出应用后还在</span></div>
      <button type="button" className="ui-button ui-button--small" onClick={refresh}>刷新</button>
      <ConfirmButton className="ui-button ui-button--small" disabled={!log?.length} confirm={{ message: "清空请求记录？", detail: "已记下的请求会全部删掉，不能撤销。", action: "清空" }} onConfirm={clear}>清空</ConfirmButton>
    </div>
    {problem && <p role="status">{problem}</p>}
    {log && log.length === 0 && <p className="ai-log-empty">还没有记录。去和宠物聊一句，再回来刷新。</p>}
    {log && log.length > 0 && <div className="ai-log-list">{log.map((entry) => <EntryView key={entry.id} entry={entry} />)}</div>}
  </div>;
}
