import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { loadFocus, saveFocus } from "./FocusStorage";

describe("FocusStorage", () => {
  it("keeps a round's length across a restart", () => {
    const storage = createMemoryStorage();
    saveFocus({ phase: "focusing", endsAt: 3_000_000, minutes: 50 }, storage);
    expect(loadFocus(storage)).toEqual({ phase: "focusing", endsAt: 3_000_000, minutes: 50 });
  });

  it("reads a round saved before lengths could be chosen", () => {
    const storage = createMemoryStorage();
    storage.setItem("ai-pet:focus:v1", JSON.stringify({ phase: "resting", endsAt: 1_000 }));
    expect(loadFocus(storage)).toEqual({ phase: "resting", endsAt: 1_000 });
  });
});
