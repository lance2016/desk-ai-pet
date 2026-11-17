import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";

/** Must match the commands and states in src-tauri/src/system.rs. */
const LAUNCH_STATUS_COMMAND = "launch_at_login_status";
const SET_LAUNCH_COMMAND = "set_launch_at_login";
const OPEN_LOGIN_ITEMS_COMMAND = "open_login_items_settings";
const SAVE_BACKUP_COMMAND = "save_backup";
const RESTART_COMMAND = "restart_app";
const OPEN_LINK_COMMAND = "open_link";
const OPEN_MICROPHONE_COMMAND = "open_microphone_settings";

/** "approval": registered, but switched off in System Settings → Login Items. */
export type LaunchAtLogin = "on" | "off" | "approval" | "unavailable";

export const systemPlatform = {
  isNative: isTauri(),

  async launchAtLogin(): Promise<LaunchAtLogin> {
    if (!isTauri()) return "unavailable";
    return invoke<LaunchAtLogin>(LAUNCH_STATUS_COMMAND);
  },

  /** Returns the state macOS reports after the change. */
  async setLaunchAtLogin(enabled: boolean): Promise<LaunchAtLogin> {
    if (!isTauri()) return "unavailable";
    return invoke<LaunchAtLogin>(SET_LAUNCH_COMMAND, { enabled });
  },

  async openLoginItemsSettings(): Promise<void> {
    if (isTauri()) await invoke(OPEN_LOGIN_ITEMS_COMMAND);
  },

  /** The installed version, such as "1.0.0"; empty in a browser. */
  async appVersion(): Promise<string> {
    return isTauri() ? getVersion() : "";
  },

  /** Opens a web link in the default browser; a browser tab outside the app. */
  async openLink(url: string): Promise<void> {
    if (isTauri()) await invoke(OPEN_LINK_COMMAND, { url });
    else window.open(url, "_blank", "noopener");
  },

  /** Opens System Settings at the microphone permissions. Does nothing in a browser. */
  async openMicrophoneSettings(): Promise<void> {
    if (isTauri()) await invoke(OPEN_MICROPHONE_COMMAND);
  },

  /** Asks where to save the file. Resolves to false when the user cancels. */
  async saveBackup(contents: string, fileName: string): Promise<boolean> {
    if (isTauri()) return invoke<boolean>(SAVE_BACKUP_COMMAND, { contents, fileName });
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: fileName });
    link.click();
    URL.revokeObjectURL(url);
    return true;
  },

  /** Starts the whole app again; in a browser, reloads the page. */
  async restart(): Promise<void> {
    if (isTauri()) await invoke(RESTART_COMMAND);
    else window.location.reload();
  },
};
