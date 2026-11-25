import { useEffect, useState } from "react";
import { petWindow } from "../../platform/petWindow";
import { loadDisplayPreferences, saveDisplayPreferences, type ChatLauncher, type DisplayPreferences } from "../../preferences/DisplayPreferences";
import { moveRadioChoice } from "./radioKeys";
import { DEFAULT_QUICK_CHAT_SHORTCUT, loadQuickChatShortcut, quickChatShortcutLabel, recordShortcut, saveQuickChatShortcut, type QuickChatShortcut } from "../../preferences/QuickChatPreferences";
import { ShortcutField } from "./ShortcutField";

const LAUNCHERS: readonly [ChatLauncher, string][] = [["left", "左侧"], ["right", "右侧"], ["none", "不显示"]];

const HINTS = {
  recording: "按下新的组合键，要包含 ⌃ 或 ⌘。按 Esc 取消。",
  "needs-modifier": "要包含 ⌃ 或 ⌘，只用 ⌥ 的组合在新版 macOS 上按了没反应。",
  "unsupported-key": "这个键不能做快捷键，换一个试试。",
  reserved: "这个组合已经被系统占用，换一个试试。",
} as const;

/** The row on 「通用 › 快捷键」 that records the global shortcut opening the quick chat bar under the pet. */
export function QuickChatShortcutRow({ onError }: { onError: (message: string | null) => void }) {
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
    <div className="settings-row">
      <div className="settings-row__body">
        <strong>打开快速聊天</strong>
        <span>{recording ? hint : "在任何应用里按下，叫出宠物脚下的输入条"}</span>
      </div>
      <ShortcutField
        name="快速聊天快捷键"
        label={shortcut ? quickChatShortcutLabel(shortcut) : null}
        recording={recording}
        onRecord={() => (recording ? stop(shortcut) : void startRecording())}
        onClear={() => void apply(null)}
        onRestore={shortcut !== DEFAULT_QUICK_CHAT_SHORTCUT ? () => void apply(DEFAULT_QUICK_CHAT_SHORTCUT) : undefined}
      />
    </div>
  );
}

/** Where the chat button sits beside the pet's head, and whether it hops after a copy. Its shortcut is on 「通用」. */
export function QuickChatSettings({ onError }: { onError: (message: string | null) => void }) {
  const [display, setDisplay] = useState(loadDisplayPreferences);
  /** Read again before saving: the dock page saves other display settings into the same place. */
  const updateDisplay = (change: Partial<DisplayPreferences>) => {
    const next = { ...loadDisplayPreferences(), ...change };
    try { saveDisplayPreferences(next); setDisplay(next); onError(null); }
    catch (reason) { console.error("Could not save the chat button setting", reason); onError("设置没能保存，请再试一次。"); }
  };
  return (
    <article className="settings-card">
      <div className="settings-row">
        <div className="settings-row__body">
          <strong>聊天按钮</strong>
          <span>{display.chatLauncher === "none" ? "不显示时，点宠物打开输入条" : "点按钮打开输入条，点宠物只是和它玩"}</span>
        </div>
        <div className="ui-segmented" role="radiogroup" onKeyDown={moveRadioChoice} aria-label="聊天按钮在头的哪一侧">
          {LAUNCHERS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={display.chatLauncher === value} className={display.chatLauncher === value ? "is-selected" : ""} onClick={() => updateDisplay({ chatLauncher: value })}>{label}</button>)}
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row__body">
          <strong>复制后提示</strong>
          <span>{display.chatLauncher === "none" ? "要先显示聊天按钮" : "在别的应用里复制后，聊天按钮会跳一跳，1 分钟内点它可以翻译、解释或存进备忘。不点就不会读取复制的内容"}</span>
        </div>
        <button type="button" role="switch" aria-label="复制后提示" aria-checked={display.copyHint} disabled={display.chatLauncher === "none"} className={display.copyHint ? "ui-switch is-on" : "ui-switch"} onClick={() => updateDisplay({ copyHint: !display.copyHint })}><span /></button>
      </div>
    </article>
  );
}
