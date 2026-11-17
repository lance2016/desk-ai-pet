import { useState } from "react";
import { loadCompanionPreferences, saveCompanionPreferences, type CompanionPreferences } from "../../preferences/CompanionPreferences";

export function CompanionSettings({ onError }: { onError: (message: string | null) => void }) {
  const [value, setValue] = useState(loadCompanionPreferences);
  const update = (next: CompanionPreferences) => {
    try { saveCompanionPreferences(next); setValue(next); onError(null); }
    catch (error) { console.error("Could not save companion settings", error); onError("设置没能保存，请再试一次。"); }
  };
  const toggle = (key: "night" | "rest" | "welcomeBack" | "nightDuringQuiet", title: string, description: string) => <div className="settings-row">
    <div className="settings-row__body"><strong>{title}</strong><span>{description}</span></div>
    <button type="button" role="switch" aria-label={title} aria-checked={value[key]} className={value[key] ? "toggle is-on" : "toggle"} onClick={() => update({ ...value, [key]: !value[key] })}><span /></button>
  </div>;
  return <div className="settings-section">
    <div className="settings-section__intro"><h2>主动陪伴</h2><p>小艾会在合适的时候关心你，也会遵守勿扰设置。</p></div>
    <div className="settings-group">
      {toggle("night", "深夜关心", "到了设定时间后仍在使用电脑，每晚最多一次")}
      <div className="settings-row"><div className="settings-row__body"><strong>关心时间</strong><span>还需持续使用约 15 分钟才会出现</span></div><input type="time" aria-label="深夜关心时间" value={value.nightTime} disabled={!value.night} onChange={(event) => { if (event.currentTarget.value) update({ ...value, nightTime: event.currentTarget.value }); }} /></div>
      {toggle("nightDuringQuiet", "定时勿扰期间也关心", "只允许深夜关心出现；手动开启勿扰时仍保持安静")}
      {toggle("rest", "休息一下", "连续使用电脑一段时间后，提醒你活动一下")}
      <div className="settings-row"><div className="settings-row__body"><strong>使用多久后提醒</strong><span>离开电脑 5 分钟后重新计时</span></div><select aria-label="使用多久后提醒" value={value.restMinutes} disabled={!value.rest} onChange={(event) => update({ ...value, restMinutes: Number(event.currentTarget.value) })}><option value={60}>60 分钟</option><option value={90}>90 分钟</option><option value={120}>120 分钟</option></select></div>
      {toggle("welcomeBack", "回来打招呼", "离开电脑至少 30 分钟后回来，偶尔说一声欢迎回来")}
    </div>
    <p className="settings-footnote">这些关心使用本机的键鼠空闲时长，不读取输入内容，也不调用 AI。专注期间不主动打扰；专注开始和结束的陪伴仍照常。默认遵守定时勿扰，时间重叠时深夜关心不会出现。</p>
  </div>;
}
