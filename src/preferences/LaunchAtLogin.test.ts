import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { applyLaunchAtLoginDefault } from "./LaunchAtLogin";

describe("applyLaunchAtLoginDefault", () => {
  it("turns opening at login on once", async () => {
    const storage = createMemoryStorage();
    const set = vi.fn(async () => "on");
    await applyLaunchAtLoginDefault(set, storage);
    await applyLaunchAtLoginDefault(set, storage);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(true);
  });

  it("tries again next time when macOS refuses", async () => {
    const storage = createMemoryStorage();
    await expect(applyLaunchAtLoginDefault(async () => { throw new Error("denied"); }, storage)).rejects.toThrow("denied");
    const set = vi.fn(async () => "on");
    await applyLaunchAtLoginDefault(set, storage);
    expect(set).toHaveBeenCalledTimes(1);
  });
});
