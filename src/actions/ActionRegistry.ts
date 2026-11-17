import type { AnimationEntry, PetManifest } from "../assets/Manifest";
import type { ActionDefinition } from "../types";

/** The action every failed lookup ends at. */
export const IDLE_ACTION = "idle";
/** Length of a one-shot action whose single frame gives no natural duration. */
const STATIC_ACTION_DURATION_MS = 1500;

function durationOf(entry: AnimationEntry): number | undefined {
  if (entry.duration !== undefined) return entry.duration;
  if (entry.loop) return undefined;
  return entry.frames > 1 ? (entry.frames / entry.fps) * 1000 : STATIC_ACTION_DURATION_MS;
}

export function toActionDefinition(entry: AnimationEntry): ActionDefinition {
  return {
    id: entry.id,
    category: entry.category,
    animation: entry.id,
    priority: entry.priority,
    loop: entry.loop,
    interruptible: entry.interruptible,
    duration: durationOf(entry),
    cooldown: entry.cooldown,
    fallback: entry.fallback,
  };
}

/** Knows which actions exist and what to play when one is missing. */
export class ActionRegistry {
  private readonly actions = new Map<string, ActionDefinition>();
  /** Fallbacks of actions that were declared but whose asset failed to load. */
  private readonly missingFallbacks = new Map<string, string | undefined>();

  register(definition: ActionDefinition): void {
    this.actions.set(definition.id, definition);
    this.missingFallbacks.delete(definition.id);
  }

  /**
   * Registers every manifest entry whose asset is available. Entries with a
   * missing asset are remembered only for their fallback.
   */
  registerManifest(manifest: PetManifest, availableAnimations: ReadonlySet<string>): void {
    for (const entry of manifest.animations) {
      if (availableAnimations.has(entry.id)) {
        this.register(toActionDefinition(entry));
      } else {
        this.missingFallbacks.set(entry.id, entry.fallback);
      }
    }
  }

  /** Forgets an action that no longer exists, such as one the user deleted. */
  unregister(id: string): void {
    this.actions.delete(id);
    this.missingFallbacks.delete(id);
  }

  has(id: string): boolean {
    return this.actions.has(id);
  }

  get(id: string): ActionDefinition | undefined {
    return this.actions.get(id);
  }

  list(): ActionDefinition[] {
    return [...this.actions.values()];
  }

  /**
   * Finds a playable action for `id`: the action itself, else the fallback
   * chain of a missing action, else idle. Undefined only if idle is missing too.
   */
  resolve(id: string): ActionDefinition | undefined {
    const visited = new Set<string>();
    let current: string | undefined = id;
    while (current !== undefined && !visited.has(current)) {
      const action = this.actions.get(current);
      if (action) return action;
      visited.add(current);
      current = this.missingFallbacks.get(current);
    }
    return this.actions.get(IDLE_ACTION);
  }
}
