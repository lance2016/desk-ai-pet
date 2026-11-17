import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANNOUNCED_KEY, CHECK_DELAY_MS, CHECK_INTERVAL_MS, startUpdateChecks, updateLine } from "./UpdateNotice";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const items = new Map<string, string>();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) };
}

describe("startUpdateChecks", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("tells the user about a new version once the first check runs", async () => {
    const say = vi.fn(() => true);
    const storage = memoryStorage();
    startUpdateChecks({ check: async () => ({ version: "1.0.1" }), say, storage });

    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS - 1);
    expect(say).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(say).toHaveBeenCalledWith(updateLine("1.0.1"));
    expect(storage.getItem(ANNOUNCED_KEY)).toBe("1.0.1");
  });

  it("does not repeat a version it has already announced", async () => {
    const say = vi.fn(() => true);
    const storage = memoryStorage();
    storage.setItem(ANNOUNCED_KEY, "1.0.1");
    startUpdateChecks({ check: async () => ({ version: "1.0.1" }), say, storage });

    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + CHECK_INTERVAL_MS);
    expect(say).not.toHaveBeenCalled();
  });

  it("tries again on the next check when the pet could not speak up", async () => {
    const say = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
    const storage = memoryStorage();
    startUpdateChecks({ check: async () => ({ version: "1.0.1" }), say, storage });

    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS);
    expect(storage.getItem(ANNOUNCED_KEY)).toBeNull();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(say).toHaveBeenCalledTimes(2);
    expect(storage.getItem(ANNOUNCED_KEY)).toBe("1.0.1");
  });

  it("stays quiet when there is no update or the check fails", async () => {
    const say = vi.fn(() => true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const check = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("offline"));
    startUpdateChecks({ check, say, storage: memoryStorage() });

    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + CHECK_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(2);
    expect(say).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("stops checking once stopped", async () => {
    const check = vi.fn(async () => null);
    const stop = startUpdateChecks({ check, say: () => true, storage: memoryStorage() });
    stop();

    await vi.advanceTimersByTimeAsync(CHECK_DELAY_MS + CHECK_INTERVAL_MS);
    expect(check).not.toHaveBeenCalled();
  });
});
