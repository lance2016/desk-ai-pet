import { invoke, isTauri } from "@tauri-apps/api/core";

/** One message at most; the native side cuts longer ones too. */
const MAX_MESSAGE_CHARS = 4000;
/** A logged object beyond its first characters is not worth the space. */
const MAX_VALUE_CHARS = 500;

type Level = "warn" | "error";

function describe(value: unknown): string {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return (JSON.stringify(value) ?? String(value)).slice(0, MAX_VALUE_CHARS);
  } catch {
    return String(value);
  }
}

/** Console arguments as one line of text, as the log keeps it. */
export function logMessage(values: readonly unknown[]): string {
  return values.map(describe).join(" ").slice(0, MAX_MESSAGE_CHARS);
}

function send(level: Level, window: string, message: string): void {
  // Never through `console`: a failure here would come straight back.
  invoke("diagnostics_log", { level, window, message }).catch(() => {});
}

/**
 * After a click, an ordinary window (settings, dubbing, chat) is the active one. When the page still
 * thinks otherwise, the native side missed telling it: no caret, and typing goes nowhere. The window
 * is then made key again (`refresh_window_focus`, see `src-tauri/src/key_window.rs`). Call once per window.
 */
export function keepWindowTypable(window: string): void {
  if (!isTauri()) return;
  document.addEventListener("click", () => {
    // After the click's default action, when a field it hit has taken focus.
    requestAnimationFrame(() => {
      // A confirmation or a save panel can rightly have the keyboard; the native side tells them apart and logs.
      if (document.hasFocus()) return;
      invoke("refresh_window_focus").catch((error: unknown) => send("error", window, `Could not make the window key again ${logMessage([error])}`));
    });
  }, true);
}

/**
 * Sends this window's warnings and errors, uncaught errors and unhandled
 * promise rejections to the log file. Call once per window. Does nothing outside the desktop app.
 */
export function forwardToLog(window: string): void {
  if (!isTauri()) return;
  for (const level of ["warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => {
      original(...values);
      send(level, window, logMessage(values));
    };
  }
  globalThis.addEventListener("error", (event) => send("error", window, `Uncaught ${logMessage([event.error ?? event.message])} (${event.filename}:${event.lineno})`));
  globalThis.addEventListener("unhandledrejection", (event) => send("error", window, `Unhandled rejection ${logMessage([event.reason])}`));
}

/** The log file; the commands live in `src-tauri/src/diagnostics.rs`. Outside the desktop app there is none. */
export const diagnosticsPlatform = {
  /** The end of the logs, newest last. */
  async readLogs(): Promise<string> {
    return isTauri() ? invoke<string>("diagnostics_read_logs") : "";
  },
  async clearLogs(): Promise<void> {
    if (isTauri()) await invoke("diagnostics_clear_logs");
  },
  async revealLogs(): Promise<void> {
    if (isTauri()) await invoke("diagnostics_reveal_logs");
  },
  /** Saves the version, the system and the recent logs. False when the user cancels or outside the desktop app. */
  async exportDiagnostics(fileName: string): Promise<boolean> {
    return isTauri() ? invoke<boolean>("diagnostics_export", { fileName }) : false;
  },
};
