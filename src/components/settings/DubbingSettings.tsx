import { useSyncExternalStore } from "react";
import { dubbingEnabled, setDubbingEnabled, subscribeDubbingEnabled } from "../../dubbing/DubbingStore";

/** 「配音」 in 小工具: whether the pet's menu offers the dubbing window. */
export function DubbingSettings() {
  const enabled = useSyncExternalStore(subscribeDubbingEnabled, () => dubbingEnabled());
  return <>
    <h2 className="settings-group-title">配音</h2>
    <div className="settings-group">
      <div className="settings-row">
        <div className="settings-row__body"><strong>右键菜单里的「配音…」</strong><span>把一段稿子用克隆的声音或内置音色读出来，导出成音频和字幕。窗口打开时才加载，关掉就不占内存</span></div>
        <button type="button" role="switch" aria-label="右键菜单里的配音" aria-checked={enabled} className={enabled ? "ui-switch is-on" : "ui-switch"} onClick={() => setDubbingEnabled(!enabled)}><span /></button>
      </div>
    </div>
  </>;
}
