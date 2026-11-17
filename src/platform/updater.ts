import { isTauri } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

/** A newer version found on the update server. */
export interface AvailableUpdate {
  version: string;
  notes: string;
  /**
   * Downloads the update and replaces the installed app; it takes effect after
   * a restart. `onProgress` gets 0–1, or null while the size is unknown.
   */
  install(onProgress: (fraction: number | null) => void): Promise<void>;
}

/**
 * The update server and its signing key are set in `tauri.conf.json`
 * (`plugins.updater`). Requests follow the system proxy.
 */
export const updaterPlatform = {
  isNative: isTauri(),

  /** A newer version, or null when this one is the latest. Null in a browser. */
  async check(): Promise<AvailableUpdate | null> {
    if (!isTauri()) return null;
    const update = await check();
    if (!update) return null;
    return {
      version: update.version,
      notes: update.body?.trim() ?? "",
      install: (onProgress) => install(update, onProgress),
    };
  },
};

async function install(update: Update, onProgress: (fraction: number | null) => void): Promise<void> {
  let total = 0;
  let received = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? 0;
      onProgress(total > 0 ? 0 : null);
    } else if (event.event === "Progress") {
      received += event.data.chunkLength;
      onProgress(total > 0 ? Math.min(1, received / total) : null);
    }
  });
}
