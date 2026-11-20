/** The pet checks a while after it starts, so the check does not compete with loading. */
export const CHECK_DELAY_MS = 60_000;
/** It usually runs for days (launch at login), so it checks again once a day. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60_000;
/** The last version the pet told the user about. */
export const ANNOUNCED_KEY = "ai-pet:update-announced:v1";

export const updateLine = (version: string) => `有新版本 ${version} 了，可以在「设置 → 通用 → 关于」里更新`;

interface UpdateNoticeDeps {
  check: () => Promise<{ version: string } | null>;
  /** Says the line if the pet may speak up now (quiet hours, rate limit); returns whether it did. */
  say: (text: string) => boolean;
  storage: Pick<Storage, "getItem" | "setItem">;
}

/**
 * Checks for a newer version now and then, and has the pet mention it once
 * per version. Returns a function that stops the checks.
 */
export function startUpdateChecks({ check, say, storage }: UpdateNoticeDeps): () => void {
  const run = async () => {
    try {
      const update = await check();
      if (!update || storage.getItem(ANNOUNCED_KEY) === update.version) return;
      if (say(updateLine(update.version))) storage.setItem(ANNOUNCED_KEY, update.version);
    } catch (error) {
      console.warn("Could not check for updates", error);
    }
  };
  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    void run();
    interval = setInterval(() => void run(), CHECK_INTERVAL_MS);
  }, CHECK_DELAY_MS);
  return () => {
    clearTimeout(first);
    if (interval !== null) clearInterval(interval);
  };
}
