import { useEffect, useState } from "react";
import { translationPlatform } from "../../platform/translation";
import { quickChatShortcutLabel, recordShortcut } from "../../preferences/QuickChatPreferences";
import { DEFAULT_TRANSLATION_SHORTCUT, loadTranslationShortcut, saveTranslationShortcut } from "../../preferences/TranslationShortcut";
import { loadSelectionFloat, saveSelectionFloat } from "../../preferences/SelectionFloat";
import { ShortcutField } from "./ShortcutField";

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
  const openTranslation = () => void translationPlatform.open().catch((error: unknown) => { console.error("Could not open translation", error); onError("没能打开翻译，请再试一次。"); });
  const openAccessibility = () => void translationPlatform.openAccessibilitySettings().catch((error: unknown) => { console.error("Could not open accessibility settings", error); onError("请在系统设置中打开辅助功能。"); });
  return (
    <article className="settings-card">
      <div className="settings-row">
        <div className="settings-row__body"><strong>快捷键</strong><span>{recording ? hint : "在任何应用里选中文字后按下，打开翻译窗口"}</span></div>
        <ShortcutField
          name="划词翻译快捷键"
          label={shortcut ? quickChatShortcutLabel(shortcut) : null}
          recording={recording}
          onRecord={() => (recording ? (setRecording(false), void apply(shortcut)) : void start())}
          onClear={() => void apply(null)}
          onRestore={shortcut !== DEFAULT_TRANSLATION_SHORTCUT ? () => void apply(DEFAULT_TRANSLATION_SHORTCUT) : undefined}
        />
      </div>
      <div className="settings-row">
        <div className="settings-row__body"><strong>划词浮钮</strong><span>选中文字后，鼠标旁出现翻译、解释、总结、润色按钮</span></div>
        <button type="button" role="switch" aria-checked={selectionFloat} aria-label="划词浮钮" className={selectionFloat ? "ui-switch is-on" : "ui-switch"} onClick={() => void toggleSelectionFloat()}><span /></button>
      </div>
      {trusted === false && (
        <div className="settings-row">
          <div className="settings-row__body"><strong>辅助功能权限</strong><span>不授权就读不到选中的文字</span></div>
          <button type="button" className="ui-button ui-button--small" onClick={openAccessibility}>打开系统设置…</button>
        </div>
      )}
      <div className="settings-row">
        <div className="settings-row__body"><strong>翻译窗口</strong><span>打开窗口，自己粘贴原文</span></div>
        <button type="button" className="ui-button ui-button--small" onClick={openTranslation}>打开翻译</button>
      </div>
    </article>
  );
}
