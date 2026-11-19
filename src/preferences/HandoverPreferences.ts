/**
 * Whether calling the pet up brings along what was copied in the last minute. Selected text
 * always comes along: selecting it is already a choice. Shared by every character.
 */
const KEY = "ai-pet:handover-clipboard:v1";

export function loadHandoverClipboard(storage: Storage = window.localStorage): boolean {
  return storage.getItem(KEY) !== "false";
}

export function saveHandoverClipboard(value: boolean, storage: Storage = window.localStorage): void {
  storage.setItem(KEY, String(value));
}
