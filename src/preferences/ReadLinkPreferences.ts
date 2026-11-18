export const READ_LINKS_KEY = "ai-pet:read-links:v1";

export function loadReadLinks(storage: Storage = window.localStorage): boolean {
  return storage.getItem(READ_LINKS_KEY) !== "false";
}

export function saveReadLinks(enabled: boolean, storage: Storage = window.localStorage): void {
  storage.setItem(READ_LINKS_KEY, String(enabled));
}
