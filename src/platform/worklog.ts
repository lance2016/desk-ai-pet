import { invoke, isTauri } from "@tauri-apps/api/core";
import type { WorkCount, WorkEvent, WorkLogData } from "../worklog/WorkLog";

const EMPTY: WorkLogData = { events: [], counts: [] };

/**
 * The work log in SQLite; the commands live in `src-tauri/src/worklog.rs`.
 * Outside the desktop app nothing is kept and reads come back empty.
 */
export const worklogPlatform = {
  async append(event: WorkEvent): Promise<void> {
    if (isTauri()) await invoke("worklog_append", { event });
  },
  /** Events and counts of the days `from` to `to` ("YYYY-MM-DD"), both included, oldest first. */
  async read(from: string, to: string): Promise<unknown> {
    return isTauri() ? invoke("worklog_read", { from, to }) : EMPTY;
  },
  /** Folds the events of days before `before` into per-day counts. */
  async compact(before: string): Promise<void> {
    if (isTauri()) await invoke("worklog_compact", { before });
  },
  async addCounts(counts: WorkCount[]): Promise<void> {
    if (isTauri()) await invoke("worklog_add_counts", { counts });
  },
  async exportAll(): Promise<unknown> {
    return isTauri() ? invoke("worklog_export") : EMPTY;
  },
  /** Replaces the whole log, as when restoring a backup. */
  async replace(log: WorkLogData): Promise<void> {
    if (isTauri()) await invoke("worklog_replace", { log });
  },
};
