import { useEffect, useState } from "react";
import { petWindow } from "../../platform/petWindow";
import { loadPanelShortcut, savePanelShortcut, type ShortcutPanel } from "../../preferences/PanelShortcuts";
import { quickChatShortcutLabel, recordShortcut } from "../../preferences/QuickChatPreferences";
import { ShortcutField } from "./ShortcutField";

const WORDS: Record<ShortcutPanel, { title: string; detail: string; name: string }> = {
  today: { title: "打开提醒", detail: "在任何应用里按下，宠物旁边打开提醒，光标在新增框里", name: "打开提醒的快捷键" },
  notes: { title: "打开备忘", detail: "在任何应用里按下，宠物旁边打开备忘，光标在新增框里", name: "打开备忘的快捷键" },
};

/** A row on 「通用 › 快捷键」 recording the shortcut that opens a panel beside the pet. None is set at first. */
export function PanelShortcutRow({ panel, onError }: { panel: ShortcutPanel; onError: (message: string | null) => void }) {
  const [shortcut, setShortcut] = useState(() => loadPanelShortcut(panel));
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState("");
  const words = WORDS[panel];
  const apply = async (value: string | null) => {
    try { await petWindow.setPanelShortcut(panel, value); savePanelShortcut(panel, value); setShortcut(value); onError(null); }
    catch (error) { console.warn(`Could not register the ${panel} shortcut`, error); await petWindow.setPanelShortcut(panel, shortcut).catch(() => {}); onError("这个快捷键用不了，可能被别的应用或另一个快捷键占用了，换一个试试。"); }
  };
  // The registered shortcut would swallow the same keys before this page sees them.
  const start = async () => { await petWindow.setPanelShortcut(panel, null).catch(() => {}); setHint("按下包含 ⌃ 或 ⌘ 的组合键，按 Esc 取消。"); setRecording(true); };
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
  return (
    <div className="settings-row">
      <div className="settings-row__body"><strong>{words.title}</strong><span>{recording ? hint : words.detail}</span></div>
      <ShortcutField
        name={words.name}
        label={shortcut ? quickChatShortcutLabel(shortcut) : null}
        recording={recording}
        onRecord={() => (recording ? (setRecording(false), void apply(shortcut)) : void start())}
        onClear={() => void apply(null)}
      />
    </div>
  );
}
