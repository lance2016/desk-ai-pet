const KEY = "ai-pet:selection-float:v1";
export function loadSelectionFloat(storage: Storage = window.localStorage): boolean { return storage.getItem(KEY) === "true"; }
export function saveSelectionFloat(enabled: boolean, storage: Storage = window.localStorage): void { storage.setItem(KEY, String(enabled)); }
