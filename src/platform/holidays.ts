import { invoke, isTauri } from "@tauri-apps/api/core";

/** Downloads official holiday data; the command lives in `src-tauri/src/holidays.rs`. */
export const holidayPlatform = {
  /** One year's schedule as JSON, or null when it is not published yet or outside the desktop app. */
  async fetchYear(year: number): Promise<string | null> {
    if (!isTauri()) return null;
    return invoke<string | null>("fetch_holiday_year", { year });
  },
};
