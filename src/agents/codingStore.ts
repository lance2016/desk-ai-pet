import { readList } from "../storage/listStorage";
import { SESSION_LIMITS, codingSessionSchema, type CodingSession } from "./CodingSession";

/**
 * The coding sessions as the pet last knew them. The pet window writes them;
 * the coding panel reads them, and so does the pet itself after a restart.
 */
const KEY = "ai-pet:coding-sessions:v1";

export function loadCodingSessions(storage: Storage = window.localStorage): CodingSession[] {
  return readList(storage, KEY, codingSessionSchema, SESSION_LIMITS.kept);
}

export function saveCodingSessions(sessions: readonly CodingSession[], storage: Storage = window.localStorage): void {
  storage.setItem(KEY, JSON.stringify(sessions.slice(0, SESSION_LIMITS.kept).map((session) => codingSessionSchema.parse(session))));
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(KEY);
  channel.postMessage("changed");
  channel.close();
}

let snapshotOf: string | null | undefined;
let snapshot: CodingSession[] = [];

/** The saved sessions, the same list until they change: what `useSyncExternalStore` asks for. */
export function codingSessionsSnapshot(): CodingSession[] {
  const raw = window.localStorage.getItem(KEY);
  if (raw !== snapshotOf) {
    snapshotOf = raw;
    snapshot = loadCodingSessions();
  }
  return snapshot;
}

/** Calls `listener` when the sessions change, in this window or another. */
export function subscribeCodingSessions(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) listener(); };
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(KEY);
  channel?.addEventListener("message", listener);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener("storage", onStorage); channel?.close(); };
}
