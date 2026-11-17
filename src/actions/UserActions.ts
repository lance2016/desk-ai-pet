import { z } from "zod";
import type { AnimationEntry, PetManifest } from "../assets/Manifest";
import { CHARACTER_DATA, characterKey } from "../preferences/CharacterPreferences";
import { IDLE_ACTION } from "./ActionRegistry";

/**
 * Actions the user makes in the action library. Only the name and length live
 * here; the picture is an appearance in `AppearanceStore`, keyed by the same id.
 */
export const USER_ACTION_CATEGORY = "custom";
/** The hyphen keeps these ids out of the actions offered to the AI (`chatContext`), which would not know what they show. */
const ID_PREFIX = "my-";
const ID_PATTERN = /^my-[a-z0-9]{6,32}$/;
const USER_ACTION_PRIORITY = 20;
const DEFAULT_DURATION_MS = 2000;

export const USER_ACTION_LIMITS = { label: 12, minDuration: 500, maxDuration: 10_000, count: 30 } as const;

const userActionSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  label: z.string().trim().min(1).max(USER_ACTION_LIMITS.label),
  duration: z.number().int().min(USER_ACTION_LIMITS.minDuration).max(USER_ACTION_LIMITS.maxDuration),
  createdAt: z.number(),
});
const listSchema = z.array(userActionSchema).max(USER_ACTION_LIMITS.count);

export type UserAction = z.infer<typeof userActionSchema>;

const storageKey = (packId: string) => characterKey(packId, CHARACTER_DATA.userActions);

export function newUserActionId(): string {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "") ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${ID_PREFIX}${random.slice(0, 12)}`;
}

export function isUserAction(action: Pick<AnimationEntry, "category">): boolean {
  return action.category === USER_ACTION_CATEGORY;
}

export function loadUserActions(packId: string, storage: Storage = window.localStorage): UserAction[] {
  try {
    const raw = storage.getItem(storageKey(packId));
    return raw ? listSchema.parse(JSON.parse(raw)) : [];
  } catch (error) {
    console.warn("Ignoring an unreadable list of user actions", error);
    return [];
  }
}

/** Adds the action, or updates the one with the same id. Throws on invalid input or when the list is full. */
export function saveUserAction(packId: string, input: Omit<UserAction, "createdAt">, storage: Storage = window.localStorage, now = Date.now()): UserAction {
  const list = loadUserActions(packId, storage);
  const existing = list.find((action) => action.id === input.id);
  const action = userActionSchema.parse({ ...input, createdAt: existing?.createdAt ?? now });
  if (!existing && list.length >= USER_ACTION_LIMITS.count) throw new Error(`At most ${USER_ACTION_LIMITS.count} user actions`);
  const next = existing ? list.map((item) => (item.id === action.id ? action : item)) : [...list, action];
  storage.setItem(storageKey(packId), JSON.stringify(listSchema.parse(next)));
  return action;
}

export function deleteUserAction(packId: string, id: string, storage: Storage = window.localStorage): void {
  storage.setItem(storageKey(packId), JSON.stringify(loadUserActions(packId, storage).filter((action) => action.id !== id)));
}

/**
 * The manifest entry for a user action. Until its picture loads it wears the
 * idle drawing, so the renderer always has a valid image for it.
 */
export function userActionEntry(idle: AnimationEntry, action: Pick<UserAction, "id" | "label" | "duration">): AnimationEntry {
  return {
    id: action.id,
    label: action.label,
    file: idle.file,
    frames: idle.frames,
    fps: idle.fps,
    loop: false,
    motion: "bounce",
    align: idle.align,
    layers: [],
    category: USER_ACTION_CATEGORY,
    priority: USER_ACTION_PRIORITY,
    interruptible: true,
    duration: action.duration,
  };
}

/** A blank action for the editor to start from. */
export function draftUserAction(animations: readonly AnimationEntry[]): AnimationEntry | null {
  const idle = animations.find((entry) => entry.id === IDLE_ACTION);
  return idle ? userActionEntry(idle, { id: "", label: "", duration: DEFAULT_DURATION_MS }) : null;
}

/** The character's actions followed by the user's own. */
export function appendUserActions(animations: readonly AnimationEntry[], actions: readonly UserAction[]): AnimationEntry[] {
  const idle = animations.find((entry) => entry.id === IDLE_ACTION);
  if (!idle) return [...animations];
  const taken = new Set(animations.map((entry) => entry.id));
  return [...animations, ...actions.filter((action) => !taken.has(action.id)).map((action) => userActionEntry(idle, action))];
}

/** The manifest with the user's actions appended; the same object when there are none. */
export function withUserActions(manifest: PetManifest, actions: readonly UserAction[]): PetManifest {
  const animations = appendUserActions(manifest.animations, actions);
  return animations.length === manifest.animations.length ? manifest : { ...manifest, animations };
}
