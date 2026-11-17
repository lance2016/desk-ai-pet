import { z } from "zod";
import { ART_PROMPT_MAX_CHARS, DEFAULT_ART_PROMPTS, usableArtPrompts, type ArtPrompts } from "../assets/ArtPrompt";
import { CHARACTER_DATA, characterKey } from "./CharacterPreferences";

/** Only the prompts the user changed are kept, so the others follow the defaults as those improve. */
const schema = z.object({
  first: z.string().max(ART_PROMPT_MAX_CHARS).optional(),
  action: z.string().max(ART_PROMPT_MAX_CHARS).optional(),
});

const promptsKey = (packId: string) => characterKey(packId, CHARACTER_DATA.artPrompts);

/** One character's art prompts: the defaults, with the user's own wording where they changed it. */
export function loadArtPrompts(packId: string, storage: Storage = window.localStorage): ArtPrompts {
  try {
    const raw = storage.getItem(promptsKey(packId));
    const saved = raw ? schema.parse(JSON.parse(raw)) : {};
    return usableArtPrompts({ ...DEFAULT_ART_PROMPTS, ...saved });
  } catch (error) {
    console.warn("Ignoring invalid art prompts", error);
    return DEFAULT_ART_PROMPTS;
  }
}

export function saveArtPrompts(packId: string, prompts: ArtPrompts, storage: Storage = window.localStorage): void {
  const usable = usableArtPrompts(prompts);
  const changed = schema.parse({
    first: usable.first === DEFAULT_ART_PROMPTS.first ? undefined : usable.first,
    action: usable.action === DEFAULT_ART_PROMPTS.action ? undefined : usable.action,
  });
  storage.setItem(promptsKey(packId), JSON.stringify(changed));
}
