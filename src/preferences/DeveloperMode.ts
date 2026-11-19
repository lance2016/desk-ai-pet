const KEY = "ai-pet:developer-mode:v1";

/** Whether chat requests are kept whole (in the app's database, by the native side) so settings can show what was sent. */
export function loadDeveloperMode(storage: Storage = window.localStorage): boolean {
  return storage.getItem(KEY) === "true";
}

export function saveDeveloperMode(enabled: boolean, storage: Storage = window.localStorage): void {
  if (enabled) storage.setItem(KEY, "true");
  else storage.removeItem(KEY);
}
