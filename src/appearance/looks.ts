import { artSource } from "../actions/StandardActions";
import { isCustomCharacter } from "../assets/PackCatalog";
import type { AnimationEntry } from "../assets/Manifest";
import type { ActionAppearance } from "./AppearanceStore";

/** The picture that stands for a character; changing it makes the character the user's own. */
const BASE_ACTION = "idle";

/** What one action shows. */
export interface Look {
  /** The action whose picture is shown: this action, or the one it borrows from. */
  source: string;
  /** False for an action that needs its own picture and has none: it cannot play. */
  playable: boolean;
}

/**
 * A character the user made wears a built-in character's pictures until it
 * gets its own idle picture. From then on it is someone else: only the
 * pictures the user gave it count, so it never turns back into the built-in one.
 */
export function hasOwnLook(packId: string, userPictures: ReadonlySet<string>): boolean {
  return isCustomCharacter(packId) && userPictures.has(BASE_ACTION);
}

/**
 * Decides which picture every action shows. An action with a picture of its
 * own shows it; the others keep their own motion and length and borrow the
 * picture of the first action along their fallback chain that has one.
 */
export function planLooks(actions: readonly AnimationEntry[], userPictures: ReadonlySet<string>, ownLook: boolean): Map<string, Look> {
  const entries = new Map(actions.map((action) => [action.id, action]));
  const hasArt = (id: string) => {
    const entry = entries.get(id);
    if (!entry) return false;
    return userPictures.has(id) || (!ownLook && entry.borrowedFrom === undefined);
  };
  return new Map(actions.map((action) => {
    const source = artSource(action.id, hasArt, (id) => entries.get(id)?.fallback);
    return [action.id, { source, playable: source === action.id || !action.requiresArt }];
  }));
}

/** The lender's picture moving the borrower's way: an action's motion and looping are its own. */
export function borrowedAppearance(borrower: Pick<AnimationEntry, "motion" | "loop">, lender: ActionAppearance): ActionAppearance {
  return {
    image: lender.image,
    frames: lender.frames,
    fps: lender.fps,
    // Props drawn for the borrower's own picture do not belong on a borrowed one.
    layers: lender.layers ?? [],
    motion: borrower.motion,
    loop: borrower.loop,
    motionSpeed: 1,
    motionStrength: 1,
  };
}
