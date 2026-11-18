interface ShortcutFieldProps {
  /** What the row sets, read out with the field: "快速聊天快捷键". */
  name: string;
  /** The shortcut as shown, or null when it is switched off. */
  label: string | null;
  recording: boolean;
  /** Starts recording, or cancels it when already recording. */
  onRecord: () => void;
  onClear: () => void;
  /** Shown only when the shortcut differs from the default. */
  onRestore?: () => void;
}

/**
 * A shortcut recorder as macOS System Settings draws it: click the field and
 * press the keys; the clear button inside the field switches the shortcut off.
 */
export function ShortcutField({ name, label, recording, onRecord, onClear, onRestore }: ShortcutFieldProps) {
  return (
    <div className="shortcut-field" role="group" aria-label={name}>
      {onRestore && <button type="button" className="settings-link" disabled={recording} onClick={onRestore}>恢复默认</button>}
      <div className={recording ? "shortcut-key is-recording" : label ? "shortcut-key" : "shortcut-key is-empty"}>
        <button type="button" className="shortcut-key__record" aria-label={recording ? `取消录制${name}` : `录制${name}，当前${label ?? "未设置"}`} onClick={onRecord}>
          {recording ? "请按键…" : label ?? "点按录制"}
        </button>
        {label && !recording && (
          <button type="button" className="shortcut-key__clear" aria-label={`停用${name}`} title="停用，可以随时重新录制" onClick={onClear}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" /><path d="m5.5 5.5 5 5m0-5-5 5" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}
