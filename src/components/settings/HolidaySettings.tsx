import { holidayCalendar, lastCoveredYear } from "../../agenda/Workdays";

/** 「隐私与数据 › 什么时候会连网」: the holiday schedule "工作日" reminders go by, and how far it reaches. */
export function HolidaySettings() {
  const covered = lastCoveredYear(holidayCalendar());
  const current = new Date().getFullYear();
  return (
    <div className="settings-row">
      <div className="settings-row__body">
        <strong>节假日数据</strong>
        <span>「工作日」提醒遇到法定假日不响，调休补班照常响。缺哪年就下载哪年，不带个人信息</span>
      </div>
      <span className="settings-row__value">{covered >= current ? `已更新到 ${covered} 年` : `只到 ${covered} 年，暂按周一到周五`}</span>
    </div>
  );
}
