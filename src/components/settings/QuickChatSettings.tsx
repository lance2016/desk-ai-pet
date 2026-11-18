import { useEffect, useState } from "react";
import { petWindow } from "../../platform/petWindow";
import { DEFAULT_QUICK_CHAT_SHORTCUT, loadQuickChatShortcut, quickChatShortcutLabel, recordShortcut, saveQuickChatShortcut, type QuickChatShortcut } from "../../preferences/QuickChatPreferences";

const HINTS = {
  recording: "按下新的组合键，要包含 ⌃ 或 ⌘。按 Esc 取消。",
  "needs-modifier": "要包含 ⌃ 或 ⌘。macOS 15 起，只用 ⌥ 或 ⌥⇧ 的全局快捷键系统不再转发。",
  "unsupported-key": "这个键不能做快捷键，换一个试试。",
  reserved: "这个组合系统或其他应用在用（比如复制、粘贴、切换应用），换一个试试。",
} as const;

/** Records the global shortcut that opens the quick chat bar under the pet. */
export function QuickChatSettings({ onError }: { onError: (message: string | null) => void }) {
  const [shortcut, setShortcut] = useState(loadQuickChatShortcut);
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string>(HINTS.recording);

  /** Registers `next`, saves it on success, and puts the old one back on failure. */
  const apply = async (next: QuickChatShortcut | null) => {
    try {
      await petWindow.setQuickChatShortcut(next);
      saveQuickChatShortcut(next);
      setShortcut(next);
      onError(null);
    } catch (reason) {
      await petWindow.setQuickChatShortcut(shortcut).catch(() => {});
      console.warn("Could not register the quick chat shortcut", reason);
      onError("这个快捷键用不了，可能被别的应用占用了，换一个试试。");
    }
  };

  const startRecording = async () => {
    // The registered shortcut would swallow the same keys before this page sees them.
    await petWindow.setQuickChatShortcut(null).catch(() => {});
    setHint(HINTS.recording);
    setRecording(true);
  };

  /** Ends recording with a new shortcut, or with the old one to cancel. */
  const stop = (next: QuickChatShortcut | null) => { setRecording(false); void apply(next); };

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === "Escape" && !event.metaKey && !event.ctrlKey) { stop(shortcut); return; }
      const result = recordShortcut(event);
      if (result.ok) stop(result.shortcut);
      else if (result.reason !== "waiting") setHint(HINTS[result.reason]);
    };
    const onBlur = () => stop(shortcut);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    return () => { window.removeEventListener("keydown", onKeyDown, true); window.removeEventListener("blur", onBlur); };
  }, [recording, shortcut]);

  return (
    <article className="settings-card">
      <div className="settings-row">
        <div className="settings-row__body">
          <strong>快捷键</strong>
          <span>{recording ? hint : "在任何应用里按一下，宠物脚下就会出现输入框；点一下宠物也可以"}</span>
        </div>
        <kbd className={recording ? "shortcut-key is-recording" : "shortcut-key"}>{recording ? "请按键…" : shortcut ? quickChatShortcutLabel(shortcut) : "已关闭"}</kbd>
        <div className="settings-button-row" role="group" aria-label="快速聊天快捷键">
          <button type="button" className="settings-button settings-button--small" onClick={() => (recording ? stop(shortcut) : void startRecording())}>{recording ? "取消" : "录制…"}</button>
          {shortcut && <button type="button" className="settings-button settings-button--small" disabled={recording} onClick={() => void apply(null)} title="不再响应这个快捷键，可以随时重新录制">停用</button>}
          {shortcut !== DEFAULT_QUICK_CHAT_SHORTCUT && <button type="button" className="settings-button settings-button--small" disabled={recording} onClick={() => void apply(DEFAULT_QUICK_CHAT_SHORTCUT)}>恢复默认</button>}
        </div>
      </div>
    </article>
  );
}
