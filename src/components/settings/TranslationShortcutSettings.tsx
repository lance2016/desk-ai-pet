import { useEffect, useState } from "react";
import { translationPlatform } from "../../platform/translation";
import { quickChatShortcutLabel, recordShortcut } from "../../preferences/QuickChatPreferences";
import { DEFAULT_TRANSLATION_SHORTCUT, loadTranslationShortcut, saveTranslationShortcut } from "../../preferences/TranslationShortcut";
import { loadSelectionFloat, saveSelectionFloat } from "../../preferences/SelectionFloat";

export function TranslationShortcutSettings({ onError }: { onError: (message: string | null) => void }) {
  const [shortcut, setShortcut] = useState(loadTranslationShortcut);
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState("");
  const [selectionFloat, setSelectionFloat] = useState(loadSelectionFloat);
  const [trusted, setTrusted] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () => void translationPlatform.selectionAvailable().then(setTrusted).catch(() => setTrusted(false));
    check(); window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, []);
  const toggleSelectionFloat = async () => {
    const enabled = !selectionFloat;
    try { await translationPlatform.setSelectionFloat(enabled); saveSelectionFloat(enabled); setSelectionFloat(enabled); onError(null); }
    catch (error) { await translationPlatform.setSelectionFloat(selectionFloat).catch(() => {}); console.error("Could not change selection translation", error); onError("划词浮钮设置没能保存，请再试一次。"); }
  };
  const apply = async (value: string | null) => {
    try { await translationPlatform.setShortcut(value); saveTranslationShortcut(value); setShortcut(value); onError(null); }
    catch (error) { console.warn("Could not register translation shortcut", error); await translationPlatform.setShortcut(shortcut).catch(() => {}); onError("翻译快捷键不可用或已被占用，请换一个。"); }
  };
  const start = async () => { await translationPlatform.setShortcut(null).catch(() => {}); setHint("按下包含 ⌃ 或 ⌘ 的组合键，按 Esc 取消。"); setRecording(true); };
  useEffect(() => {
    if (!recording) return;
    const stop = (value: string | null) => { setRecording(false); void apply(value); };
    const key = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopPropagation();
      if (event.code === "Escape" && !event.metaKey && !event.ctrlKey) { stop(shortcut); return; }
      const result = recordShortcut(event);
      if (result.ok) stop(result.shortcut);
      else if (result.reason !== "waiting") setHint("请使用包含 ⌃ 或 ⌘ 的组合键，避开系统快捷键。");
    };
    const blur = () => stop(shortcut);
    window.addEventListener("keydown", key, true); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", key, true); window.removeEventListener("blur", blur); };
  }, [recording, shortcut]);
  return <article className="settings-card"><div className="settings-row"><div className="settings-row__body"><strong>划词翻译快捷键</strong><span>{recording ? hint : "选中文字后按快捷键打开翻译；读取选区需要在 macOS 辅助功能中允许 AI Pet。未授权时可以粘贴。"}</span></div><kbd className={recording ? "shortcut-key is-recording" : "shortcut-key"}>{recording ? "请按键…" : shortcut ? quickChatShortcutLabel(shortcut) : "已关闭"}</kbd><div className="settings-button-row"><button type="button" className="settings-button settings-button--small" onClick={() => void translationPlatform.open().catch((error: unknown) => { console.error("Could not open translation", error); onError("没能打开翻译，请再试一次。"); })}>打开翻译</button><button type="button" className="settings-button settings-button--small" onClick={() => recording ? (setRecording(false), void apply(shortcut)) : void start()}>{recording ? "取消" : "录制…"}</button>{shortcut && <button type="button" className="settings-button settings-button--small" disabled={recording} onClick={() => void apply(null)} title="不再响应这个快捷键，可以随时重新录制">停用</button>}{shortcut !== DEFAULT_TRANSLATION_SHORTCUT && <button type="button" className="settings-button settings-button--small" disabled={recording} onClick={() => void apply(DEFAULT_TRANSLATION_SHORTCUT)}>恢复默认</button>}</div></div><div className="settings-row"><div className="settings-row__body"><strong>划词浮钮</strong><span>选中文字后在鼠标旁显示翻译按钮；仅在点击翻译后发送内容。{selectionFloat && trusted === false ? "请先允许辅助功能权限。" : ""}</span></div>{selectionFloat && trusted === false && <button type="button" className="settings-button settings-button--small" onClick={() => void translationPlatform.openAccessibilitySettings().catch((error: unknown) => { console.error("Could not open accessibility settings", error); onError("请在系统设置中打开辅助功能。"); })}>打开辅助功能</button>}<button type="button" role="switch" aria-checked={selectionFloat} aria-label="划词浮钮" className={selectionFloat ? "toggle is-on" : "toggle"} onClick={() => void toggleSelectionFloat()} /></div></article>;
}
