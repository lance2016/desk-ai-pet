import { expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { loadSelectionFloat, saveSelectionFloat } from "./SelectionFloat";

it("keeps selection monitoring off until the user enables it", () => {
  const storage = createMemoryStorage();
  expect(loadSelectionFloat(storage)).toBe(false);
  saveSelectionFloat(true, storage);
  expect(loadSelectionFloat(storage)).toBe(true);
  saveSelectionFloat(false, storage);
  expect(loadSelectionFloat(storage)).toBe(false);
});
