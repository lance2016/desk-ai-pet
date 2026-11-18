import { describe, expect, it } from "vitest";
import { FEATURE_COLORS, FEATURE_ICONS } from "../guide/featureIcons";
import { ANNOUNCED_KEY, CURRENT_VERSION, SEEN_KEY, announceUpdate, markWhatsNewSeen, notesFor, shouldShowWhatsNew, skipWhatsNew, updatedLine } from "./WhatsNew";
import notes from "./releaseNotes.json";

const memory = (): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
};

describe("release notes", () => {
  it("has notes for the version being built", () => {
    expect(notesFor(CURRENT_VERSION)?.features.length).toBeGreaterThan(0);
  });

  it("only uses icons and colors the sheet can draw", () => {
    for (const entry of Object.values(notes)) {
      for (const feature of entry.features) {
        expect(FEATURE_ICONS).toContain(feature.icon);
        expect(FEATURE_COLORS).toContain(feature.color);
        expect(feature.title.trim()).not.toBe("");
        expect(feature.detail.trim()).not.toBe("");
      }
    }
  });
});

describe("what's new", () => {
  it("opens by itself until it has been closed for this version", () => {
    const storage = memory();
    expect(shouldShowWhatsNew(storage)).toBe(true);
    markWhatsNewSeen(storage);
    expect(shouldShowWhatsNew(storage)).toBe(false);
    expect(shouldShowWhatsNew(storage, "9.9.9")).toBe(false);
  });

  it("says once that the pet was updated", () => {
    const storage = memory();
    const said: string[] = [];
    announceUpdate(storage, (text) => { said.push(text); return true; });
    announceUpdate(storage, (text) => { said.push(text); return true; });
    expect(said).toEqual([updatedLine(CURRENT_VERSION)]);
    expect(storage.data.get(ANNOUNCED_KEY)).toBe(CURRENT_VERSION);
  });

  it("tries again next time when the pet could not speak up", () => {
    const storage = memory();
    announceUpdate(storage, () => false);
    expect(storage.data.has(ANNOUNCED_KEY)).toBe(false);
  });

  it("says nothing once the sheet was seen, or to a new user", () => {
    const seen = memory();
    markWhatsNewSeen(seen);
    const fresh = memory();
    skipWhatsNew(fresh);
    const said: string[] = [];
    announceUpdate(seen, (text) => { said.push(text); return true; });
    announceUpdate(fresh, (text) => { said.push(text); return true; });
    expect(said).toEqual([]);
    expect(fresh.data.get(SEEN_KEY)).toBe(CURRENT_VERSION);
  });
});
