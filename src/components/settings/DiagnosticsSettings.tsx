import { useCallback, useEffect, useMemo, useState } from "react";
import { filterLog, logText, parseLog, type LevelFilter, type LogEntry } from "../../diagnostics/logEntries";
import { diagnosticsPlatform } from "../../platform/diagnostics";
import { ConfirmButton } from "../ConfirmButton";
import { moveRadioChoice } from "./radioKeys";

/** Entries drawn at most; the rest are a search or a copy away. */
const MAX_SHOWN = 300;
const DONE_MS = 1_500;
const LEVELS: Array<[LevelFilter, string]> = [["all", "全部"], ["warn", "警告"], ["error", "错误"]];
const LEVEL_CLASS: Partial<Record<LogEntry["level"], string>> = { ERROR: "is-error", WARN: "is-warn" };

const pad = (value: number) => String(value).padStart(2, "0");
const todayKey = () => { const now = new Date(); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`; };
/** "13:05:01" today, "11月18日 13:05:01" on another day. */
const when = (entry: LogEntry, today: string) => (entry.date === today ? entry.time : `${Number(entry.date.slice(5, 7))}月${Number(entry.date.slice(8))}日 ${entry.time}`);

/** A flag that goes back to false a moment after it is set, for "已复制" and the like. */
function useBriefly(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  useEffect(() => { if (!on) return; const timer = setTimeout(() => setOn(false), DONE_MS); return () => clearTimeout(timer); }, [on]);
  return [on, () => setOn(true)];
}

/** 「关于 → 日志与诊断」: the app's log, to see what went wrong, and an export to send to someone. */
export function DiagnosticsSettings({ onError }: { onError: (message: string | null) => void }) {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [query, setQuery] = useState("");
  const [copied, markCopied] = useBriefly();
  const [exported, markExported] = useBriefly();

  const refresh = useCallback(() => {
    diagnosticsPlatform.readLogs()
      .then((text) => { setEntries(parseLog(text)); onError(null); })
      .catch((reason: unknown) => { console.error("Could not read the logs", reason); onError("读不到日志，请再试一次。"); });
  }, [onError]);
  useEffect(refresh, [refresh]);
  // Problems happen in other windows: look again when settings comes back to the front.
  useEffect(() => { window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [refresh]);

  const matching = useMemo(() => filterLog(entries ?? [], level, query), [entries, level, query]);
  const shown = useMemo(() => matching.slice(-MAX_SHOWN).reverse(), [matching]);
  const today = todayKey();

  const copy = () => void navigator.clipboard.writeText(logText(matching)).then(markCopied).catch((reason: unknown) => { console.error("Could not copy the logs", reason); onError("没能复制，请再试一次。"); });
  const reveal = () => void diagnosticsPlatform.revealLogs().catch((reason: unknown) => { console.error("Could not show the log folder", reason); onError("没能打开日志文件夹。"); });
  const clear = () => void diagnosticsPlatform.clearLogs().then(refresh).catch((reason: unknown) => { console.error("Could not clear the logs", reason); onError("没能清理日志，请再试一次。"); });
  const exportReport = () => {
    const now = new Date();
    diagnosticsPlatform.exportDiagnostics(`AI Pet 诊断 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.txt`)
      .then((saved) => { if (saved) markExported(); onError(null); })
      .catch((reason: unknown) => { console.error("Could not export diagnostics", reason); onError("没能导出。换一个保存位置（比如「文稿」）再试一次。"); });
  };

  const empty = entries !== null && entries.length === 0;
  const errors = (entries ?? []).filter((entry) => entry.level === "ERROR").length;
  return (
    <div className="settings-section diagnostics-page">
      <p className="settings-page-intro">出了问题看这里。日志只记应用自己的运行情况，不含聊天内容和 API Key。</p>
      <div className="settings-group">
        <div className="settings-row">
          <div className="settings-row__body"><strong>导出诊断信息</strong><span>{exported ? "已导出。需要时把这个文件发给帮你排查的人。" : "版本号、系统版本和最近的日志存成一个文件，应用不会自动上传"}</span></div>
          <button type="button" className="ui-button ui-button--small" onClick={exportReport}>导出…</button>
        </div>
        <div className="settings-row">
          <div className="settings-row__body"><strong>日志文件</strong><span>{entries === null ? "正在读取…" : empty ? "还没有日志" : `共 ${entries.length} 条，其中错误 ${errors} 条`}</span></div>
          <div className="settings-button-row">
            <button type="button" className="ui-button ui-button--small" onClick={reveal}>在访达中显示</button>
            <ConfirmButton className="ui-button ui-button--small" disabled={empty} confirm={{ message: "清理日志？", detail: "日志文件会全部删掉，不能撤销。", action: "清理" }} onConfirm={clear}>清理…</ConfirmButton>
          </div>
        </div>
      </div>
      <h2 className="settings-group-title">日志</h2>
      <div className="log-viewer__bar">
        <div className="ui-segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="日志级别">
          {LEVELS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={level === value} className={level === value ? "is-selected" : ""} onClick={() => setLevel(value)}>{label}</button>)}
        </div>
        <input type="search" className="log-viewer__search" placeholder="搜索" aria-label="搜索日志" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
        <button type="button" className="ui-button ui-button--small" onClick={refresh}>刷新</button>
        <button type="button" className="ui-button ui-button--small" disabled={matching.length === 0} onClick={copy}>{copied ? "已复制" : "复制"}</button>
      </div>
      {empty && <p className="log-viewer__note">还没有日志。出了问题再来这里看。</p>}
      {!empty && entries !== null && shown.length === 0 && <p className="log-viewer__note">没有符合条件的日志。</p>}
      {shown.length > 0 && (
        <ol className="log-viewer__list" aria-label="日志，最新的在最上面">
          {shown.map((entry, index) => (
            <li key={`${entry.date}${entry.time}${index}`} className={LEVEL_CLASS[entry.level]}>
              <span className="log-viewer__meta"><time>{when(entry, today)}</time>{entry.source}</span>
              <span className="log-viewer__message">{entry.message}</span>
            </li>
          ))}
        </ol>
      )}
      {matching.length > MAX_SHOWN && <p className="log-viewer__note">只显示最新的 {MAX_SHOWN} 条，共 {matching.length} 条。「复制」会带上全部。</p>}
    </div>
  );
}
