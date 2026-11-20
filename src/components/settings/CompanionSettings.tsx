import { useState, type ReactNode } from "react";
import { QuietSettings } from "./QuietSettings";
import { loadCompanionPreferences, saveCompanionPreferences, type CompanionPreferences } from "../../preferences/CompanionPreferences";
import { petWindow } from "../../platform/petWindow";
import { OCCASIONS } from "../../companion";

type Switch = "morningGreeting" | "night" | "rest" | "welcomeBack" | "nightDuringQuiet";

/** 「陪伴」: when the pet speaks up by itself (the morning greeting, the check-ins) and when it keeps quiet. */
export function CompanionSettings({ name, onError }: { name: string; onError: (message: string | null) => void }) {
  const [value, setValue] = useState(loadCompanionPreferences);
  const [tried, setTried] = useState(OCCASIONS[0].id);
  const [testBusy, setTestBusy] = useState(false);
  const [testStatus, setTestStatus] = useState("");
  const update = (next: CompanionPreferences) => {
    try { saveCompanionPreferences(next); setValue(next); onError(null); }
    catch (error) { console.error("Could not save companion settings", error); onError("设置没能保存，请再试一次。"); }
  };
  /** A switch, with the value it goes by (a time, a length) on the same row when it has one. */
  const toggle = (key: Switch, title: string, description: string, setting?: ReactNode, disabled = false) => <div className="settings-row">
    <div className="settings-row__body"><strong>{title}</strong><span>{description}</span></div>
    {setting}
    <button type="button" role="switch" aria-label={title} aria-checked={value[key]} disabled={disabled} className={value[key] ? "toggle is-on" : "toggle"} onClick={() => update({ ...value, [key]: !value[key] })}><span /></button>
  </div>;
  const preview = async () => {
    setTestBusy(true);
    setTestStatus("正在准备这句话…");
    try {
      await petWindow.testCompanion(tried);
      setTestStatus("已显示在宠物气泡里。");
    } catch (error) {
      console.error("Could not preview a companion line", error);
      setTestStatus(error instanceof Error ? error.message : "这句话没能显示，请再试一次。");
    } finally { setTestBusy(false); }
  };
  return <div className="settings-section">
    <div className="settings-section__intro"><h2>早安问候</h2><p>单独设置每天的早安时间</p></div>
    <div className="settings-group">
      {toggle("morningGreeting", "每天说早安", "到这个时间后的 4 小时内，你开始用电脑时问候一次；定时勿扰时会延后",
        <input type="time" aria-label="早安时间" value={value.morningTime} disabled={!value.morningGreeting} onChange={(event) => { if (event.currentTarget.value) update({ ...value, morningTime: event.currentTarget.value }); }} />)}
    </div>
    <p className="settings-footnote">生成问候会请求一次 DeepSeek，可能产生少量费用；不可用时会显示本地问候</p>
    <div className="settings-section__intro"><h2>关心</h2><p>{name}会在合适的时候关心你，勿扰时不出声</p></div>
    <div className="settings-group">
      {toggle("night", "深夜关心", "过了这个时间还在用电脑，提醒你早点休息",
        <input type="time" aria-label="深夜关心时间" value={value.nightTime} disabled={!value.night} onChange={(event) => { if (event.currentTarget.value) update({ ...value, nightTime: event.currentTarget.value }); }} />)}
      {toggle("rest", "休息一下", "连续用电脑这么久，提醒你起来活动；离开 5 分钟后重新计时",
        <select aria-label="使用多久后提醒" value={value.restMinutes} disabled={!value.rest} onChange={(event) => update({ ...value, restMinutes: Number(event.currentTarget.value) })}><option value={60}>60 分钟</option><option value={90}>90 分钟</option><option value={120}>120 分钟</option></select>)}
      {toggle("welcomeBack", "回来打招呼", "离开 30 分钟以上再回来时，说声欢迎回来")}
      <div className="settings-row">
        <div className="settings-row__body"><strong>预览一句</strong><span>现在就说一次选中的这句，不占用当天的次数</span></div>
        <select aria-label="要预览的话" value={tried} disabled={testBusy} onChange={(event) => setTried(event.currentTarget.value)}>{OCCASIONS.map((occasion) => <option key={occasion.id} value={occasion.id}>{occasion.title}</option>)}</select>
        <button type="button" className="settings-button settings-button--small" disabled={testBusy} onClick={() => void preview()}>{testBusy ? "正在准备…" : "预览"}</button>
      </div>
      {testStatus && <p className="ai-settings__status" role="status">{testStatus}</p>}
    </div>
    <p className="settings-footnote">关心只看键盘和鼠标有没有在用，不读输入的内容，也不调用 AI。专注时不打扰。</p>
    <h2 className="settings-group-title">勿扰</h2>
    {/* Only matters while quiet hours are on and night care is: greyed out otherwise, so it is still found. */}
    <QuietSettings onError={onError} during={(enabled) => <><div className="settings-divider" />{toggle("nightDuringQuiet", "定时勿扰时照样深夜关心", enabled && value.night ? "手动勿扰时仍然不打扰" : "要先打开「定时勿扰」和「深夜关心」", undefined, !enabled || !value.night)}</>} />
  </div>;
}
