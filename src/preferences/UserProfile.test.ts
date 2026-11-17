import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { isOnboarded, loadUserProfile, markOnboarded, saveUserProfile, USER_PROFILE_LIMITS } from "./UserProfile";

describe("user profile", () => {
  it("starts without a nickname and keeps a trimmed one", () => {
    const storage = createMemoryStorage();
    expect(loadUserProfile(storage)).toEqual({ nickname: "" });
    saveUserProfile({ nickname: " 阿龙 " }, storage);
    expect(loadUserProfile(storage)).toEqual({ nickname: "阿龙" });
  });

  it("rejects names that are too long and ignores unreadable data", () => {
    const storage = createMemoryStorage();
    expect(() => saveUserProfile({ nickname: "一".repeat(USER_PROFILE_LIMITS.nickname + 1) }, storage)).toThrow();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    storage.setItem("ai-pet:user-profile:v1", "{");
    expect(loadUserProfile(storage)).toEqual({ nickname: "" });
    warn.mockRestore();
  });

  it("remembers that the welcome guide is done", () => {
    const storage = createMemoryStorage();
    expect(isOnboarded(storage)).toBe(false);
    markOnboarded(storage);
    expect(isOnboarded(storage)).toBe(true);
  });
});
