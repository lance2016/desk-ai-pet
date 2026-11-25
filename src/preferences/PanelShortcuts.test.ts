import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { loadPanelShortcut, savePanelShortcut } from "./PanelShortcuts";

describe("panel shortcuts", () => {
  it("has none until the user records one, and keeps each panel's own", () => {
    const storage = createMemoryStorage();
    expect(loadPanelShortcut("today", storage)).toBeNull();
    savePanelShortcut("today", "Control+Super+KeyR", storage);
    expect(loadPanelShortcut("today", storage)).toBe("Control+Super+KeyR");
    expect(loadPanelShortcut("notes", storage)).toBeNull();
    savePanelShortcut("today", null, storage);
    expect(loadPanelShortcut("today", storage)).toBeNull();
  });

  it("drops a stored value the recorder would not make", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:notes-shortcut:v1", JSON.stringify("Alt+KeyN"));
    expect(loadPanelShortcut("notes", storage)).toBeNull();
    warning.mockRestore();
  });
});
