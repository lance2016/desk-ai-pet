import type { CSSProperties } from "react";
import type { UsageDay } from "../../../usage/usageSummary";
import { HoverTip, useSlotPointer } from "./HoverTip";
import { dayText, niceMax, shortDay, WEEKDAY_NAMES, WEEKEND } from "./usageText";

const at = (index: number, count: number) => (index + 0.5) / count;

/** The x axis: every weekday for a week, Mondays for a month, and today. */
function DayTicks({ days }: { days: readonly UsageDay[] }) {
  const short = days.length <= 7;
  return <div className="usage-day-chart__ticks" aria-hidden="true">
    {days.map((day, index) => {
      const today = index === days.length - 1;
      if (!today && !short && day.weekday !== 0) return null;
      // A Monday too close to today would run into its label.
      if (!today && !short && index > days.length - 4) return null;
      return <span key={day.day} className={today ? "is-today" : undefined} style={{ left: `${at(index, days.length) * 100}%` }}>
        {today ? "今天" : short ? WEEKDAY_NAMES[day.weekday] : shortDay(day.day)}
      </span>;
    })}
  </div>;
}

/** Uses each day: round grid lines, the average as a dashed line, weekends on a faint band, and the numbers on hover. */
export function DayChart({ days, focus }: { days: readonly UsageDay[]; focus: string | null }) {
  const pointer = useSlotPointer(days.length);
  const sum = days.reduce((total, day) => total + day.count, 0);
  const top = niceMax(Math.max(...days.map((day) => day.count)));
  const average = sum / days.length;
  const hovered = pointer.index === null ? null : days[pointer.index];
  const label = `${focus ?? "所有功能"}，${days.length} 天共 ${sum} 次，平均每天 ${average.toFixed(1)} 次`;
  return <div className="usage-day-chart">
    <span className="usage-day-chart__title">{focus ? `「${focus}」每天几次` : "每天用了几次"}</span>
    {/* Counts are whole: a half-way mark like 2.5 is left unlabelled. */}
    <div className="usage-day-chart__scale" aria-hidden="true"><span>{top}</span><span>{Number.isInteger(top / 2) ? top / 2 : ""}</span><span>0</span></div>
    <div className={`usage-day-chart__plot${hovered ? " is-pointing" : ""}`} role="img" aria-label={label} {...pointer.plotProps}>
      <span className="usage-day-chart__grid" style={{ "--y": 1 } as CSSProperties} />
      <span className="usage-day-chart__grid" style={{ "--y": 0.5 } as CSSProperties} />
      {days.map((day, index) => <span key={day.day} className={`usage-day-chart__slot${WEEKEND.has(day.weekday) ? " is-weekend" : ""}${index === pointer.index ? " is-hovered" : ""}`} onPointerEnter={() => pointer.enter(index)}>
        {day.count > 0 && <span className="usage-day-chart__bar" style={{ "--share": day.count / top } as CSSProperties} />}
      </span>)}
      {sum > 0 && <span className="usage-day-chart__average" style={{ "--y": average / top } as CSSProperties}><span>平均 {average.toFixed(1)}</span></span>}
      {sum === 0 && <p className="usage-day-chart__empty">这段时间没有记录</p>}
      {hovered && pointer.index !== null && <HoverTip at={at(pointer.index, days.length)} top={1 - hovered.count / top} title={`${dayText(hovered.day)} ${WEEKDAY_NAMES[hovered.weekday]}`} value={`${hovered.count} 次`} />}
    </div>
    <DayTicks days={days} />
  </div>;
}
