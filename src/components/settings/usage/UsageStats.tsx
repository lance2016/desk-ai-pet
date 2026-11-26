import { useCallback, useEffect, useMemo, useState } from "react";
import { summarizeUsage, USAGE_RANGES, USAGE_READ_DAYS, type UsageRange } from "../../../usage/usageSummary";
import { Icon } from "../../../ui/icons";
import { readWorkLog } from "../../../worklog/store";
import { addDays, type WorkLogData } from "../../../worklog/WorkLog";
import { moveRadioChoice } from "../radioKeys";
import { FeatureTable } from "./FeatureTable";
import { UsageOverview } from "./UsageOverview";
import { dayText } from "./usageText";
import { WeekHeatmap } from "./WeekHeatmap";
import "./UsageStats.css";

/** Developer mode's 「使用统计」: which features got used, on which days and at what hours, against the range before. */
export function UsageStats() {
  const [log, setLog] = useState<{ data: WorkLogData; at: number } | null>(null);
  const [problem, setProblem] = useState("");
  const [range, setRange] = useState<UsageRange>(7);
  const [focus, setFocus] = useState<string | null>(null);
  const refresh = useCallback(() => {
    const now = Date.now();
    setProblem("");
    readWorkLog(addDays(now, -(USAGE_READ_DAYS - 1)), now)
      .then((data) => setLog({ data, at: now }))
      .catch((reason: unknown) => { console.error("Could not read the usage counts", reason); setProblem("读不到使用记录，请在桌面应用中重试。"); });
  }, []);
  useEffect(refresh, [refresh]);
  // Uses happen in other windows: look again when settings comes back to the front.
  useEffect(() => { window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [refresh]);

  const summary = useMemo(() => (log ? summarizeUsage(log.data, log.at, range, focus) : null), [log, range, focus]);
  const focusLabel = summary?.groups.flatMap((group) => group.lines).find((line) => line.id === focus)?.label ?? null;
  const empty = summary !== null && summary.since === null && summary.uses.count === 0;

  return <div className="settings-section usage">
    <div className="usage-toolbar">
      <div className="ui-segmented" role="radiogroup" aria-label="时间范围" onKeyDown={moveRadioChoice}>
        {USAGE_RANGES.map((days) => <button key={days} type="button" role="radio" aria-checked={range === days} className={range === days ? "is-selected" : ""} onClick={() => setRange(days)}>最近 {days} 天</button>)}
      </div>
      {focusLabel && <span className="usage-toolbar__focus">只看：{focusLabel}
        <button type="button" aria-label="看全部功能" onClick={() => setFocus(null)}><Icon name="close" /></button>
      </span>}
      <button type="button" className="ui-button ui-button--small usage-toolbar__refresh" onClick={refresh}>刷新</button>
    </div>
    {problem && <p className="settings-footnote" role="status">{problem}</p>}
    {empty && <div className="settings-card usage-empty">
      <Icon name="chart" />
      <p>还没有使用记录。在安装版里用上一阵，这里会画出每天什么时候用了哪些功能。</p>
    </div>}
    {summary && !empty && <>
      <UsageOverview summary={summary} focusLabel={focusLabel} />
      <h2 className="settings-group-title">星期和时段{focusLabel ? `：${focusLabel}` : ""}</h2>
      <div className="settings-card"><WeekHeatmap heat={summary.heat} /></div>
      <div className="settings-group-head usage-features-head">
        <h2 className="settings-group-title">各功能</h2>
        <span>趋势</span><span>次数</span><span>比前 {range} 天</span>
      </div>
      <FeatureTable summary={summary} focus={focus} onFocus={setFocus} />
    </>}
    <p className="settings-footnote">
      只记哪个功能、什么时候用了，不记内容；开发模式下不记。{summary?.since ? `从 ${dayText(summary.since)} 开始记。` : ""}
      {summary && summary.agentTurns > 0 ? `宠物主动搭话和 Claude Code 自己做完的事不算在图表里，这段时间 Claude Code 做完 ${summary.agentTurns} 轮。` : ""}
    </p>
  </div>;
}
