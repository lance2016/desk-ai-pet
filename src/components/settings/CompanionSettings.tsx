import { useState, type ReactNode } from "react";
import { TimeField } from "../TimeField";
import { QuietSettings } from "./QuietSettings";
import { loadCompanionPreferences, saveCompanionPreferences, type CompanionPreferences } from "../../preferences/CompanionPreferences";
import { petWindow } from "../../platform/petWindow";
import { OCCASIONS } from "../../companion";
import { hushedUntil, setHush } from "../../companion/hush";
import { formatReminderTime } from "../../agenda/AgendaStore";

type Switch = "morningGreeting" | "night" | "rest" | "welcomeBack" | "nightDuringQuiet" | "headsUp" | "followUp" | "careByModel";

/** 「陪伴」: when the pet speaks up by itself (the morning greeting, the check-ins) and when it keeps quiet. */
export function CompanionSettings({ name, onError }: { name: string; onError: (message: string | null) => void }) {
  const [value, setValue] = useState(loadCompanionPreferences);
  const [tried, setTried] = useState(OCCASIONS[0].id);
  const [testBusy, setTestBusy] = useState(false);
  const [testStatus, setTestStatus] = useState("");
  /** Until when the user told the pet in a chat to keep to itself; null when it may speak up. */
  const [hushed, setHushed] = useState(() => hushedUntil(Date.now()));
  const speakAgain = () => {
    try { setHush(null); setHushed(null); onError(null); }
    catch (error) { console.error("Could not let the pet speak up again", error); onError("设置没能保存，请再试一次。"); }
  };
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
        <TimeField label="早安时间" value={value.morningTime} disabled={!value.morningGreeting} onChange={(morningTime) => update({ ...value, morningTime })} />)}
    </div>
    <p className="settings-footnote">生成问候会请求一次 DeepSeek，可能产生少量费用；不可用时会显示本地问候</p>
    <div className="settings-section__intro"><h2>关心</h2><p>{name}会在合适的时候关心你，勿扰时不出声</p></div>
    <div className="settings-group">
      {hushed !== null && <div className="settings-row">
        <div className="settings-row__body"><strong>正在安静</strong><span>你让它别催，{formatReminderTime(hushed, Date.now())} 前不主动说话；提醒照常到点</span></div>
        <button type="button" className="settings-button settings-button--small" onClick={speakAgain}>恢复说话</button>
      </div>}
      {toggle("night", "深夜关心", "过了这个时间还在用电脑，提醒你早点休息",
        <TimeField label="深夜关心时间" value={value.nightTime} disabled={!value.night} onChange={(nightTime) => update({ ...value, nightTime })} />)}
      {toggle("rest", "休息一下", "连续用电脑这么久，提醒你起来活动；离开 5 分钟后重新计时",
        <select aria-label="使用多久后提醒" value={value.restMinutes} disabled={!value.rest} onChange={(event) => update({ ...value, restMinutes: Number(event.currentTarget.value) })}><option value={60}>60 分钟</option><option value={90}>90 分钟</option><option value={120}>120 分钟</option></select>)}
      {toggle("headsUp", "提醒前说一声", "一次性的提醒，到点前 10 分钟先说一声；刚设不到 1 小时的不说")}
      {toggle("followUp", "回来问一句", "提醒响过后你离开了一阵，回来时顺着那件事问一句")}
      {toggle("welcomeBack", "回来打招呼", "离开 30 分钟以上再回来时，说声欢迎回来")}
      {toggle("careByModel", "关心的话由 AI 来写", "带上今天做了什么，按角色的语气说；关掉后每次都是固定的一句")}
      <div className="settings-row">
        <div className="settings-row__body"><strong>预览一句</strong><span>现在就说一次选中的这句，不占用当天的次数</span></div>
        <select aria-label="要预览的话" value={tried} disabled={testBusy} onChange={(event) => setTried(event.currentTarget.value)}>{OCCASIONS.map((occasion) => <option key={occasion.id} value={occasion.id}>{occasion.title}</option>)}</select>
        <button type="button" className="settings-button settings-button--small" disabled={testBusy} onClick={() => void preview()}>{testBusy ? "正在准备…" : "预览"}</button>
      </div>
      {testStatus && <p className="ai-settings__status" role="status">{testStatus}</p>}
    </div>
    <p className="settings-footnote">关心只看键盘和鼠标有没有在用，不读输入的内容，等你手停下来才说。连着几句没人理，它会说得少一些，摸摸它或回一句就恢复；聊天时说「今晚别催我」，它到明早都不主动说话。由 AI 来写时，每句话说之前请求一次 DeepSeek，带上今天专注了几轮、完成了几个提醒、下一个提醒是什么，「回来问一句」还带上那条提醒；关掉后不调用 AI。专注时不打扰。</p>
    <h2 className="settings-group-title">勿扰</h2>
    {/* Only matters while quiet hours are on and night care is: greyed out otherwise, so it is still found. */}
    <QuietSettings onError={onError} during={(enabled) => <><div className="settings-divider" />{toggle("nightDuringQuiet", "定时勿扰时照样深夜关心", enabled && value.night ? "手动勿扰时仍然不打扰" : "要先打开「定时勿扰」和「深夜关心」", undefined, !enabled || !value.night)}</>} />
  </div>;
}
