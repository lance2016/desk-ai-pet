/** Whether the pet reacts to coding sessions with poses and lines of its own. The card shows them either way. */
export const CODING_REACTIONS_KEY = "ai-pet:coding-reactions:v1";

export function loadCodingReactions(storage: Storage = window.localStorage): boolean {
  return storage.getItem(CODING_REACTIONS_KEY) !== "false";
}

export function saveCodingReactions(enabled: boolean, storage: Storage = window.localStorage): void {
  storage.setItem(CODING_REACTIONS_KEY, String(enabled));
}
