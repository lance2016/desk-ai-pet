import { useEffect, useState, type ReactNode } from "react";
import { petWindow } from "../../platform/petWindow";
import { loadQuietPreferences, saveQuietPreferences, subscribeQuietPreferences, type QuietPreferences } from "../../preferences/QuietPreferences";
import { eveningGreetingTime } from "../../greeting/GreetingSchedule";

/** Do-not-disturb and daily quiet hours. Shared by every character. `during` adds options that only apply while quiet hours are on. */
export function QuietSettings({ onError, during }: { onError: (message: string | null) => void; during?: (enabled: boolean) => ReactNode }) {
  const [value, setValue] = useState(loadQuietPreferences);
  useEffect(() => subscribeQuietPreferences(() => setValue(loadQuietPreferences())), []);

  const update = (next: QuietPreferences) => {
    try {
      saveQuietPreferences(next);
      setValue(next);
      onError(null);
    } catch (reason) {
      console.error("Could not save the quiet settings", reason);
      onError("勿扰设置没能保存，请再试一次。");
    }
  };
  const updateDoNotDisturb = (enabled: boolean) => {
    update({ ...value, doNotDisturb: enabled });
    void petWindow.setDoNotDisturb(enabled).catch((reason: unknown) => { console.error("Could not tick do-not-disturb in the menu", reason); onError("已经生效，但右键菜单里的勾没跟上，重启 AI Pet 后会对上。"); });
  };
  const hours = value.quietHours;

  return (
    <article className="settings-card">
      <div className="settings-row"><div className="settings-row__body"><strong>手动勿扰</strong><span>宠物不主动说话，到点的提醒先攒在脚下，关掉后再弹出</span></div><button type="button" role="switch" aria-checked={value.doNotDisturb} aria-label="手动勿扰" className={value.doNotDisturb ? "toggle is-on" : "toggle"} onClick={() => updateDoNotDisturb(!value.doNotDisturb)}><span /></button></div>
      <div className="settings-divider" />
      <div className="settings-row"><div className="settings-row__body"><strong>定时勿扰</strong><span>每天这段时间不主动说话，提醒照常弹出</span></div><button type="button" role="switch" aria-checked={hours.enabled} aria-label="定时勿扰" className={hours.enabled ? "toggle is-on" : "toggle"} onClick={() => update({ ...value, quietHours: { ...hours, enabled: !hours.enabled } })}><span /></button></div>
      {/* Greyed out, not hidden, when off: the greetings still go by these times. */}
      <div className={hours.enabled ? "quiet-hours" : "quiet-hours is-off"}>
        <label>从<input type="time" disabled={!hours.enabled} value={hours.start} onChange={(event) => { const start = event.currentTarget.value; if (start) update({ ...value, quietHours: { ...hours, start } }); }} /></label>
        <label>到<input type="time" disabled={!hours.enabled} value={hours.end} onChange={(event) => { const end = event.currentTarget.value; if (end) update({ ...value, quietHours: { ...hours, end } }); }} /></label>
      </div>
      <p className="quiet-hours__note">{hours.end} 后道早安，{eveningGreetingTime(hours.start)} 道晚安。</p>
      {during?.(hours.enabled)}
    </article>
  );
}
