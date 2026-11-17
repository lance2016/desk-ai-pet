import { z } from "zod";
import { STAT_MAX, STAT_MIN } from "../core/PetState";
import { CHARACTER_DATA, characterKey } from "../preferences/CharacterPreferences";

/** The pet size is shared by every character; stats belong to one. */
const SCALE_KEY = "ai-pet:scale";

const statSchema = z.number().min(STAT_MIN).max(STAT_MAX);

const savedPetSchema = z.object({
  stats: z.object({
    satiety: statSchema,
    energy: statSchema,
    mood: statSchema,
    affinity: statSchema,
  }),
  /** Epoch milliseconds the stats were valid at. */
  savedAt: z.number().finite(),
});

const scaleSchema = z.coerce.number().positive().finite();

export type SavedPet = z.infer<typeof savedPetSchema>;

/** Storage boundary, so the backing store can change without touching callers. */
export interface PetStorage {
  loadPet(): SavedPet | null;
  savePet(pet: SavedPet): void;
  loadScale(): number | null;
  saveScale(scale: number): void;
}

export function createLocalPetStorage(storage: Storage, packId: string): PetStorage {
  const petKey = characterKey(packId, CHARACTER_DATA.pet);
  return {
    loadPet() {
      const raw = storage.getItem(petKey);
      if (raw === null) return null;
      try {
        // Stored data is external input, so it is validated before use.
        return savedPetSchema.parse(JSON.parse(raw));
      } catch (error) {
        console.warn("Ignoring invalid saved pet data", error);
        return null;
      }
    },
    savePet(pet) {
      storage.setItem(petKey, JSON.stringify(pet));
    },
    loadScale() {
      const raw = storage.getItem(SCALE_KEY);
      if (raw === null) return null;
      const result = scaleSchema.safeParse(raw);
      return result.success ? result.data : null;
    },
    saveScale(scale) {
      storage.setItem(SCALE_KEY, String(scale));
    },
  };
}
