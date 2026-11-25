import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { agentCaptureEnabled, setAgentCaptureEnabled } from "./CapturePreferences";

describe("CapturePreferences", () => {
  it("keeps coding agents from taking pictures until the user turns it on", () => {
    expect(agentCaptureEnabled(createMemoryStorage())).toBe(false);
  });

  it("remembers the switch", () => {
    const storage = createMemoryStorage();
    setAgentCaptureEnabled(true, storage);
    expect(agentCaptureEnabled(storage)).toBe(true);
    setAgentCaptureEnabled(false, storage);
    expect(agentCaptureEnabled(storage)).toBe(false);
  });
});
