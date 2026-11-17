/** Set once the installed app has turned opening at login on by itself. */
const DEFAULT_APPLIED_KEY = "ai-pet:launch-at-login-default:v1";

/**
 * Reminders only fire while the pet runs, so the app opens at login unless the
 * user says otherwise. This turns it on the first time only; a later "off" in
 * settings or System Settings stays off.
 */
export async function applyLaunchAtLoginDefault(setEnabled: (enabled: boolean) => Promise<unknown>, storage: Storage = window.localStorage): Promise<void> {
  if (storage.getItem(DEFAULT_APPLIED_KEY) !== null) return;
  await setEnabled(true);
  storage.setItem(DEFAULT_APPLIED_KEY, "1");
}
