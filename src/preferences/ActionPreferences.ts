import { z } from "zod";
import type { AnimationEntry } from "../assets/Manifest";
import { CHARACTER_DATA, characterKey } from "./CharacterPreferences";

/** Only finite, non-system actions may be requested without changing pet state. */
export function canShortcut(action: AnimationEntry): boolean {
  return action.category !== "system" && (!action.loop || action.duration !== undefined);
}

const schema = z.array(z.string().min(1).max(100)).max(100);
const disabledIdleKey = (packId: string) => characterKey(packId, CHARACTER_DATA.disabledIdleActions);

export function loadDisabledIdleActions(packId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(disabledIdleKey(packId));
    return raw ? [...new Set(schema.parse(JSON.parse(raw)))] : [];
  } catch (error) {
    console.warn("Ignoring invalid idle action preferences", error);
    return [];
  }
}

export function saveDisabledIdleActions(packId: string, ids: string[]): void {
  window.localStorage.setItem(disabledIdleKey(packId), JSON.stringify(schema.parse([...new Set(ids)])));
}
