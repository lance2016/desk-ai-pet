/**
 * Reads the log file the native side writes (`src-tauri/src/diagnostics.rs`):
 * `[2026-11-19][13:05:01][ai_pet_lib::llm][WARN] message`. Lines without that
 * start, such as a stack trace, belong to the entry above them.
 */

export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE";
export type LevelFilter = "all" | "warn" | "error";

export interface LogEntry {
  date: string;
  time: string;
  level: LogLevel;
  /** Where it came from, for people: a window, or a part of the native side. */
  source: string;
  message: string;
}

const LINE = /^\[(\d{4}-\d{2}-\d{2})\]\[(\d{2}:\d{2}:\d{2})\]\[([^\]]*)\]\[(ERROR|WARN|INFO|DEBUG|TRACE)\] ?(.*)$/;
/** Messages from the windows come as `[window] text` under this target. */
const WEBVIEW_TARGET = "webview";
const WINDOW_NAMES: Record<string, string> = {
  main: "宠物",
  settings: "设置",
  chat: "聊天",
  today: "提醒",
  notes: "备忘",
  translation: "翻译",
};
const NATIVE_CRATE = "ai_pet_lib";

function sourceOf(target: string, message: string): { source: string; message: string } {
  if (target === WEBVIEW_TARGET) {
    const window = /^\[([^\]]+)\] ?/.exec(message);
    if (window) return { source: WINDOW_NAMES[window[1]] ?? window[1], message: message.slice(window[0].length) };
    return { source: "界面", message };
  }
  const [crate, ...path] = target.split("::");
  return { source: crate === NATIVE_CRATE ? `原生 ${path.join("::") || "主程序"}` : target, message };
}

/** The entries in `text`, oldest first. */
export function parseLog(text: string): LogEntry[] {
  const entries: LogEntry[] = [];
  for (const line of text.split("\n")) {
    const match = LINE.exec(line);
    if (match) {
      const [, date, time, target, level, message] = match;
      entries.push({ date, time, level: level as LogLevel, ...sourceOf(target, message) });
    } else if (entries.length > 0 && line !== "") {
      const last = entries[entries.length - 1];
      entries[entries.length - 1] = { ...last, message: `${last.message}\n${line}` };
    }
  }
  return entries;
}

/** Entries at `level` or worse whose source or message contains every word of `query`. */
export function filterLog(entries: readonly LogEntry[], level: LevelFilter, query: string): LogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (level === "error" && entry.level !== "ERROR") return false;
    if (level === "warn" && entry.level !== "ERROR" && entry.level !== "WARN") return false;
    const text = `${entry.source} ${entry.message}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Entries back as text, one per line as the file had them, for copying. */
export function logText(entries: readonly LogEntry[]): string {
  return entries.map((entry) => `${entry.date} ${entry.time} ${entry.level} [${entry.source}] ${entry.message}`).join("\n");
}
