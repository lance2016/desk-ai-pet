import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { summarizeUsage, USAGE_DAYS, type UsageSummary } from "../../usage/usageSummary";
import { readWorkLog } from "../../worklog/store";
import { addDays } from "../../worklog/WorkLog";

/** Hours written under the strip. */
const HOUR_TICKS = [0, 6, 12, 18, 24];

/** "2026-11-26" as "11月26日". */
const dayText = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
const share = (count: number, most: number) => (most > 0 ? count / most : 0);

function DayBars({ days }: { days: UsageSummary["days"] }) {
  const most = Math.max(...days.map((day) => day.count));
  return <div className="usage-days">
    <div className="usage-days__plot" role="img" aria-label={`最近 ${USAGE_DAYS} 天每天用了几次，最多一天 ${most} 次`}>
      {days.map(({ day, count }) => <span key={day} className="usage-days__slot" title={`${dayText(day)}：${count} 次`}>
        <span className="usage-days__bar" style={{ "--share": share(count, most) } as CSSProperties} />
      </span>)}
    </div>
    <div className="usage-axis"><span>{dayText(days[0].day)}</span><span>最多一天 {most} 次</span><span>今天</span></div>
  </div>;
}

function HourStrip({ hours }: { hours: UsageSummary["hours"] }) {
  const most = Math.max(...hours);
  return <div className="usage-hours">
    <div className="usage-hours__cells" role="img" aria-label="一天里各个小时用了几次">
      {hours.map((count, hour) => <span key={hour} className="usage-hours__cell" title={`${hour}:00–${hour + 1}:00：${count} 次`} style={{ "--share": share(count, most) } as CSSProperties} />)}
    </div>
    <div className="usage-axis usage-hours__ticks">{HOUR_TICKS.map((hour) => <span key={hour}>{hour}</span>)}</div>
  </div>;
}

/** What the user did, most first. Features not used in the month go on one line under it: that line is what to cut. */
function FeatureList({ lines }: { lines: UsageSummary["lines"] }) {
  const used = lines.filter((line) => line.month > 0);
  const unused = lines.filter((line) => line.month === 0);
  const most = Math.max(0, ...used.map((line) => line.month));
  return <>
    <ul className="usage-features">
      {used.map((line) => <li key={line.id}>
        <span className="usage-features__label">{line.label}</span>
        <span className="usage-features__track"><span className="usage-features__bar" style={{ "--share": share(line.month, most) } as CSSProperties} /></span>
        <span className="usage-features__count">{line.week}</span>
        <span className="usage-features__count">{line.month}</span>
      </li>)}
    </ul>
    {unused.length > 0 && <p className="usage-unused">30 天里没用过：{unused.map((line) => line.label).join("、")}</p>}
  </>;
}

/** Developer mode's 「使用统计」: which features got used in the last 30 days, on which days and at what hours. */
export function UsageStats() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [problem, setProblem] = useState("");
  const refresh = useCallback(() => {
    const now = Date.now();
    setProblem("");
    readWorkLog(addDays(now, -(USAGE_DAYS - 1)), now)
      .then((log) => setSummary(summarizeUsage(log, now)))
      .catch((reason: unknown) => { console.error("Could not read the usage counts", reason); setProblem("读不到使用记录，请在桌面应用中重试。"); });
  }, []);
  useEffect(refresh, [refresh]);
  // Uses happen in other windows: look again when settings comes back to the front.
  useEffect(() => { window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [refresh]);

  const startedLate = summary?.since && summary.since > summary.days[0].day;
  const { said = 0, answered = 0 } = summary?.greetings ?? {};
  const agentTurns = summary?.lines.find((line) => line.id === "agent_turn")?.month ?? 0;
  return <div className="settings-section">
    <div className="settings-card">
      <div className="ai-preview__head usage-head">
        <div>
          <strong>最近 {USAGE_DAYS} 天</strong>
          <span>只记哪个功能、什么时候用了，不记内容；开发模式下不记{startedLate ? `。从 ${dayText(summary.since!)} 开始记` : ""}</span>
        </div>
        <button type="button" className="ui-button ui-button--small" onClick={refresh}>刷新</button>
      </div>
    </div>
    {problem && <p className="settings-footnote" role="status">{problem}</p>}
    {summary && <>
      <h2 className="settings-group-title">每天</h2>
      <div className="settings-card"><DayBars days={summary.days} /></div>
      <h2 className="settings-group-title">一天里的时段</h2>
      <div className="settings-card"><HourStrip hours={summary.hours} /></div>
      <div className="settings-group-head usage-features-head">
        <h2 className="settings-group-title">各功能</h2>
        <span>7 天</span><span>30 天</span>
      </div>
      <div className="settings-card"><FeatureList lines={summary.lines.filter((line) => !line.byPet)} /></div>
      <p className="settings-footnote">
        不是你发起的，不算在上面和每天、时段里：30 天里宠物主动搭话 {said} 次，你回了 {answered} 次{said > 0 ? `（${Math.round((answered / said) * 100)}%）` : ""}；Claude Code 做完 {agentTurns} 轮。
      </p>
    </>}
  </div>;
}
