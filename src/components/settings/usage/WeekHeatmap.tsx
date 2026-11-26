import type { CSSProperties } from "react";
import { HoverTip, useSlotPointer } from "./HoverTip";
import { WEEKDAY_NAMES } from "./usageText";

const HOURS = 24;
const TICKS = [0, 6, 12, 18, 24];
/** Steps on the legend, from none to the busiest hour. */
const LEGEND = [0, 0.25, 0.5, 0.75, 1];

/** Uses by weekday and hour: one hue, darker for more. Arrow keys walk the cells. */
export function WeekHeatmap({ heat }: { heat: readonly (readonly number[])[] }) {
  const cells = heat.flatMap((row, weekday) => row.map((count, hour) => ({ weekday, hour, count })));
  const pointer = useSlotPointer(cells.length);
  const most = Math.max(...cells.map((cell) => cell.count));
  const hovered = pointer.index === null ? null : cells[pointer.index];
  const busiest = cells.reduce((best, cell) => (cell.count > best.count ? cell : best), cells[0]);
  const label = most > 0 ? `最常在${WEEKDAY_NAMES[busiest.weekday]} ${busiest.hour} 点用，那个小时 ${busiest.count} 次` : "这段时间没有带时间的记录";
  return <div className="usage-heat">
    <div className="usage-heat__legend" aria-hidden="true">少{LEGEND.map((share) => <span key={share} style={{ "--share": share } as CSSProperties} />)}多</div>
    <div className="usage-heat__body">
      <div className="usage-heat__days" aria-hidden="true">{WEEKDAY_NAMES.map((name) => <span key={name}>{name}</span>)}</div>
      <div className="usage-heat__plot" role="img" aria-label={label} {...pointer.plotProps}>
        {cells.map((cell, index) => <span key={index} className={`usage-heat__cell${index === pointer.index ? " is-hovered" : ""}`} style={{ "--share": most > 0 ? cell.count / most : 0 } as CSSProperties} onPointerEnter={() => pointer.enter(index)} />)}
        {hovered && <HoverTip at={(hovered.hour + 0.5) / HOURS} top={hovered.weekday / heat.length} title={`${WEEKDAY_NAMES[hovered.weekday]} ${hovered.hour}:00–${hovered.hour + 1}:00`} value={`${hovered.count} 次`} />}
      </div>
      <span />
      <div className="usage-heat__ticks" aria-hidden="true">{TICKS.map((hour) => <span key={hour} style={{ left: `${(hour / HOURS) * 100}%` }}>{hour}</span>)}</div>
    </div>
  </div>;
}
