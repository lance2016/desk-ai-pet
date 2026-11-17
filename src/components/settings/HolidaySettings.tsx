import { holidayCalendar, lastCoveredYear } from "../../agenda/Workdays";

/** How "工作日" reminders count working days, and how far the holiday schedule reaches. */
export function HolidaySettings() {
  const covered = lastCoveredYear(holidayCalendar());
  const current = new Date().getFullYear();
  return (
    <article className="settings-card">
      <div className="settings-row">
        <div className="settings-row__body">
          <strong>工作日</strong>
          <span>设成“工作日”的提醒按国家法定节假日和调休安排：放假不响，调休补班照常响。新一年的安排公布后会自动下载</span>
        </div>
        <span className="settings-row__value">{covered >= current ? `已更新到 ${covered} 年` : `只到 ${covered} 年，暂按周一到周五`}</span>
      </div>
    </article>
  );
}
