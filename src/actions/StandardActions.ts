import { z } from "zod";
import { parseManifest, standardActionSchema, type PetManifest } from "../assets/Manifest";
import catalog from "./standardActions.json";

/**
 * The actions every character has, with or without a picture for them. The
 * catalog says how each one plays and how to draw it; a character only brings
 * the pictures it has, and the rest wear the picture of their `fallback`.
 */
export const STANDARD_ACTIONS = z.object({ actions: z.array(standardActionSchema).min(1) }).parse(catalog).actions;

export type StandardAction = (typeof STANDARD_ACTIONS)[number];

/** The action every borrowing chain ends at. */
const LAST_RESORT = "idle";

/** Just enough of a pack's manifest to merge the catalog in; the full check comes after. */
const packShape = z.looseObject({ animations: z.array(z.looseObject({ id: z.string() })) });

/**
 * The first action along `id`'s fallback chain, itself first, that `hasArt`.
 * Idle when none has, since a character cannot exist without it.
 */
export function artSource(id: string, hasArt: (id: string) => boolean, fallbackOf: (id: string) => string | undefined): string {
  const visited = new Set<string>();
  let current: string | undefined = id;
  while (current !== undefined && !visited.has(current)) {
    if (hasArt(current)) return current;
    visited.add(current);
    current = fallbackOf(current);
  }
  return LAST_RESORT;
}

/**
 * A pack's raw manifest with the catalog worked in: its own entries take the
 * catalog's settings unless they set their own, and every standard action the
 * pack has no picture for is added wearing a borrowed one. Standard actions
 * come first, in the catalog's order (most needed first), which is also the
 * order of the art prompt; the pack's extra actions follow.
 */
export function withStandardActions(raw: unknown, standard: readonly StandardAction[] = STANDARD_ACTIONS): unknown {
  const pack = packShape.safeParse(raw);
  if (!pack.success) return raw;
  const catalogued = new Map(standard.map((action) => [action.id, action]));
  const drawn = new Map(pack.data.animations.map((entry): [string, Record<string, unknown>] => [entry.id, { ...catalogued.get(entry.id), ...entry }]));
  const standardEntries = standard.flatMap((action) => {
    const own = drawn.get(action.id);
    if (own) return [own];
    const lender = artSource(action.id, (id) => drawn.has(id), (id) => catalogued.get(id)?.fallback);
    const picture = drawn.get(lender);
    // A pack without idle is rejected when the pet starts; nothing to borrow here.
    if (!picture) return [];
    return [{ ...action, file: picture.file, frames: picture.frames, fps: picture.fps, layers: picture.layers, borrowedFrom: lender }];
  });
  const extras = pack.data.animations.filter((entry) => !catalogued.has(entry.id)).flatMap((entry) => drawn.get(entry.id) ?? []);
  return { ...pack.data, animations: [...standardEntries, ...extras] };
}

/** Validates a pack's manifest as characters use it: with the standard actions worked in. */
export function parsePackManifest(raw: unknown): PetManifest {
  return parseManifest(withStandardActions(raw));
}
