import { useState } from "react";
import { QuietSettings } from "./QuietSettings";
import { HolidaySettings } from "./HolidaySettings";
import { loadCompanionPreferences, saveCompanionPreferences, type CompanionPreferences } from "../../preferences/CompanionPreferences";

export function CompanionSettings({ name, onError }: { name: string; onError: (message: string | null) => void }) {
  const [value, setValue] = useState(loadCompanionPreferences);
  const update = (next: CompanionPreferences) => {
    try { saveCompanionPreferences(next); setValue(next); onError(null); }
    catch (error) { console.error("Could not save companion settings", error); onError("设置没能保存，请再试一次。"); }
  };
  const toggle = (key: "night" | "rest" | "welcomeBack" | "nightDuringQuiet", title: string, description: string, disabled = false) => <div className="settings-row">
    <div className="settings-row__body"><strong>{title}</strong><span>{description}</span></div>
    <button type="button" role="switch" aria-label={title} aria-checked={value[key]} disabled={disabled} className={value[key] ? "toggle is-on" : "toggle"} onClick={() => update({ ...value, [key]: !value[key] })}><span /></button>
  </div>;
  return <div className="settings-section">
    <div className="settings-section__intro"><h2>关心</h2><p>{name}会在合适的时候关心你，勿扰时不出声</p></div>
    <div className="settings-group">
      {toggle("night", "深夜关心", "过了这个时间还在用电脑，提醒你早点休息")}
      <div className="settings-row"><div className="settings-row__body"><strong>关心时间</strong><span>到点后还在用电脑才会出现</span></div><input type="time" aria-label="深夜关心时间" value={value.nightTime} disabled={!value.night} onChange={(event) => { if (event.currentTarget.value) update({ ...value, nightTime: event.currentTarget.value }); }} /></div>
      {toggle("rest", "休息一下", "连续用电脑太久，提醒你起来活动")}
      <div className="settings-row"><div className="settings-row__body"><strong>使用多久后提醒</strong><span>离开电脑 5 分钟后重新计时</span></div><select aria-label="使用多久后提醒" value={value.restMinutes} disabled={!value.rest} onChange={(event) => update({ ...value, restMinutes: Number(event.currentTarget.value) })}><option value={60}>60 分钟</option><option value={90}>90 分钟</option><option value={120}>120 分钟</option></select></div>
      {toggle("welcomeBack", "回来打招呼", "离开 30 分钟以上再回来时，说声欢迎回来")}
    </div>
    <p className="settings-footnote">只看键盘和鼠标有没有在用，不读输入的内容，也不调用 AI。专注时不打扰。</p>
    <h2 className="settings-group-title">勿扰</h2>
    {/* Only matters while quiet hours are on and night care is: greyed out otherwise, so it is still found. */}
    <QuietSettings onError={onError} during={(enabled) => <><div className="settings-divider" />{toggle("nightDuringQuiet", "定时勿扰时照样深夜关心", enabled && value.night ? "手动勿扰时仍然不打扰" : "要先打开「定时勿扰」和「深夜关心」", !enabled || !value.night)}</>} />
    <h2 className="settings-group-title">提醒</h2>
    <HolidaySettings />
  </div>;
}
