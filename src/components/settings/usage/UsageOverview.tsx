import { changeText, type UsageSummary } from "../../../usage/usageSummary";
import { DayChart } from "./DayChart";
import { dayChange } from "./usageText";

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** One figure across the top: what it counts, the number, and a line under it. */
function Figure({ name, value, unit, note }: { name: string; value: string; unit?: string; note: string }) {
  return <div className="usage-figure">
    <span className="usage-figure__name">{name}</span>
    <span className={`usage-figure__value${/^[\d—]/.test(value) ? "" : " is-text"}`}>{value}{unit && <small>{unit}</small>}</span>
    <span className="usage-figure__note">{note}</span>
  </div>;
}

/** The range at a glance, then the days of it: one card, the page's main picture. */
export function UsageOverview({ summary, focusLabel }: { summary: UsageSummary; focusLabel: string | null }) {
  const { range, uses, activeDays, top, greetings, comparable } = summary;
  const before = `比前 ${range} 天`;
  const compare = (text: string) => (comparable ? `${before} ${text}` : `前 ${range} 天还没开始记`);
  return <div className="settings-card usage-overview">
    <div className="usage-figures">
      <Figure name="使用" value={String(uses.count)} unit="次" note={compare(changeText(uses.count, uses.previous))} />
      <Figure name="用到的天数" value={String(activeDays.count)} unit={`/ ${range} 天`} note={compare(dayChange(activeDays.count, activeDays.previous))} />
      <Figure name="最常用" value={top?.label ?? "—"} note={top ? `${top.count} 次，占 ${percent(top.count, uses.count)}%` : "这段时间还没用过"} />
      <Figure name="回宠物的话" value={greetings.said > 0 ? String(percent(greetings.answered, greetings.said)) : "—"} unit={greetings.said > 0 ? "%" : undefined}
        note={greetings.said > 0 ? `搭话 ${greetings.said} 次，回了 ${greetings.answered} 次` : "它这段时间没主动搭话"} />
    </div>
    <DayChart days={summary.days} focus={focusLabel} />
  </div>;
}
