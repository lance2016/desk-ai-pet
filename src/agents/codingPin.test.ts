import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { loadPinnedFolder, savePinnedFolder } from "./codingPin";
import { SESSION_LIMITS } from "./CodingSession";

describe("pinned folder", () => {
  it("keeps the pinned folder until the pin is taken off", () => {
    const storage = createMemoryStorage();
    expect(loadPinnedFolder(storage)).toBeNull();
    savePinnedFolder("ai-pet", storage);
    expect(loadPinnedFolder(storage)).toBe("ai-pet");
    savePinnedFolder(null, storage);
    expect(loadPinnedFolder(storage)).toBeNull();
  });

  it("ignores a saved value that cannot be a folder name", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:coding-pinned:v1", "x".repeat(SESSION_LIMITS.name + 1));
    expect(loadPinnedFolder(storage)).toBeNull();
  });
});
