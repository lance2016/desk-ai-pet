import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { EMPTY_DRAFT, dubbingEnabled, loadDraft, saveDraft, setDubbingEnabled } from "./DubbingStore";

describe("dubbing draft", () => {
  it("starts empty and keeps what was saved", () => {
    const storage = createMemoryStorage();
    expect(loadDraft(storage)).toEqual(EMPTY_DRAFT);
    const draft = { text: "大家好。", voice: "clone:0123456789abcdef", style: "慢一点", format: "wav" as const, subtitles: false };
    saveDraft(draft, storage);
    expect(loadDraft(storage)).toEqual(draft);
  });

  it("falls back to an empty draft when the saved one is broken", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:dubbing-draft:v1", "{not json");
    expect(loadDraft(storage)).toEqual(EMPTY_DRAFT);
    storage.setItem("ai-pet:dubbing-draft:v1", JSON.stringify({ ...EMPTY_DRAFT, format: "mp3" }));
    expect(loadDraft(storage)).toEqual(EMPTY_DRAFT);
  });
});

describe("dubbing switch", () => {
  it("is on until turned off", () => {
    const storage = createMemoryStorage();
    expect(dubbingEnabled(storage)).toBe(true);
    setDubbingEnabled(false, storage);
    expect(dubbingEnabled(storage)).toBe(false);
    setDubbingEnabled(true, storage);
    expect(dubbingEnabled(storage)).toBe(true);
  });
});
