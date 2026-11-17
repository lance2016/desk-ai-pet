import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { createLocalPetStorage } from "./PetStorage";

const PET = { stats: { satiety: 10, energy: 20, mood: 30, affinity: 40 }, savedAt: 1000 };

afterEach(() => vi.restoreAllMocks());

describe("PetStorage", () => {
  it("returns null when nothing was saved", () => {
    const storage = createLocalPetStorage(createMemoryStorage(), "test-pet");
    expect(storage.loadPet()).toBeNull();
    expect(storage.loadScale()).toBeNull();
  });

  it("restores what was saved, as a new instance would after a restart", () => {
    const backing = createMemoryStorage();
    createLocalPetStorage(backing, "test-pet").savePet(PET);
    createLocalPetStorage(backing, "test-pet").saveScale(1.3);

    const afterRestart = createLocalPetStorage(backing, "test-pet");
    expect(afterRestart.loadPet()).toEqual(PET);
    expect(afterRestart.loadScale()).toBe(1.3);
  });

  it.each([
    ["broken JSON", "{not json"],
    ["a missing stat", JSON.stringify({ stats: { satiety: 1, energy: 2, mood: 3 }, savedAt: 1 })],
    ["an out-of-range stat", JSON.stringify({ ...PET, stats: { ...PET.stats, mood: 999 } })],
    ["a non-numeric time", JSON.stringify({ ...PET, savedAt: "yesterday" })],
  ])("ignores saved data with %s", (_name, raw) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const storage = createLocalPetStorage(createMemoryStorage({ "ai-pet:character:test-pet:pet": raw }), "test-pet");
    expect(storage.loadPet()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("keeps each character's stats apart but shares the pet size", () => {
    const backing = createMemoryStorage();
    createLocalPetStorage(backing, "girl").savePet(PET);
    createLocalPetStorage(backing, "girl").saveScale(1.3);
    const cat = createLocalPetStorage(backing, "cat");
    expect(cat.loadPet()).toBeNull();
    expect(cat.loadScale()).toBe(1.3);
  });

  it.each(["abc", "0", "-2"])("ignores the invalid scale %s", (raw) => {
    const storage = createLocalPetStorage(createMemoryStorage({ "ai-pet:scale": raw }), "test-pet");
    expect(storage.loadScale()).toBeNull();
  });
});
