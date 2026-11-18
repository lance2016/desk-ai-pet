import { expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { CHARACTER_DATA, characterKey } from "./CharacterPreferences";
import { loadActionTriggerStats, recordActionTrigger } from "./ActionTriggerStats";

it("starts at zero, counts real starts by character, and ignores prior action history", () => {
  const storage = createMemoryStorage({ "ai-pet:action-trigger-stats": JSON.stringify({ remind: 12 }) });
  expect(loadActionTriggerStats("six-six", storage)).toEqual({});

  recordActionTrigger("six-six", "remind", storage);
  recordActionTrigger("six-six", "remind", storage);
  recordActionTrigger("girl-default", "idle", storage);

  expect(loadActionTriggerStats("six-six", storage)).toEqual({ remind: 2 });
  expect(loadActionTriggerStats("girl-default", storage)).toEqual({ idle: 1 });
  expect(storage.getItem(characterKey("six-six", CHARACTER_DATA.actionTriggerStats))).toBe(JSON.stringify({ remind: 2 }));
});

it("ignores malformed saved statistics", () => {
  const storage = createMemoryStorage({ [characterKey("six-six", CHARACTER_DATA.actionTriggerStats)]: "{broken" });
  expect(loadActionTriggerStats("six-six", storage)).toEqual({});
});
