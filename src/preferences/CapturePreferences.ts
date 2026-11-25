/** Whether coding agents may take pictures of the pet's windows (`ai-pet --capture`). Off until turned on in 设置 › 小工具. */
const KEY = "ai-pet:agent-capture:v1";
const CHANGED = "ai-pet:agent-capture-changed";

export function agentCaptureEnabled(storage: Storage = window.localStorage): boolean {
  return storage.getItem(KEY) === "true";
}

export function setAgentCaptureEnabled(enabled: boolean, storage: Storage = window.localStorage): void {
  storage.setItem(KEY, String(enabled));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED));
}

/** Calls `listener` when the switch changes, in this window or another. */
export function subscribeAgentCapture(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGED, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGED, listener);
  };
}
