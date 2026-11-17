import type { EventBus } from "../core/EventBus";
import type { PetRenderer } from "../renderer/PetRenderer";
import type { ActionDefinition, ActionResult, PetEvents } from "../types";
import { IDLE_ACTION, type ActionRegistry } from "./ActionRegistry";

interface ControllerDeps {
  registry: ActionRegistry;
  renderer: Pick<PetRenderer, "playAction" | "stopAction">;
  bus: EventBus<PetEvents>;
}

/** A new action may replace the current one only if it is allowed to and at least as important. */
function canInterrupt(current: ActionDefinition, next: ActionDefinition): boolean {
  return current.interruptible && next.priority >= current.priority;
}

/** Plays one main action at a time and decides which request wins. */
export class ActionController {
  private currentAction: ActionDefinition | null = null;
  private completionTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly lastStartedAt = new Map<string, number>();

  constructor(private readonly deps: ControllerDeps) {}

  get current(): ActionDefinition | null {
    return this.currentAction;
  }

  /** Asks to play an action. Unknown or missing actions degrade to their fallback, then idle. */
  request(id: string): ActionResult {
    const next = this.deps.registry.resolve(id);
    if (!next) return { accepted: false, reason: "unavailable" };

    const current = this.currentAction;
    // Asking for the open-ended action that is already playing changes nothing.
    if (current?.id === next.id && next.duration === undefined) {
      return { accepted: true, actionId: next.id };
    }
    if (this.isCoolingDown(next)) return { accepted: false, reason: "cooldown" };
    if (current && !canInterrupt(current, next)) return { accepted: false, reason: "busy" };

    this.play(next);
    return { accepted: true, actionId: next.id };
  }

  /** Abandons the current action, whatever its priority, and returns to idle. */
  stop(): void {
    this.clearTimer();
    this.currentAction = null;
    const idle = this.deps.registry.resolve(IDLE_ACTION);
    if (idle) {
      this.play(idle);
    } else {
      this.deps.renderer.stopAction();
    }
  }

  dispose(): void {
    this.clearTimer();
    this.currentAction = null;
  }

  private isCoolingDown(action: ActionDefinition): boolean {
    const startedAt = this.lastStartedAt.get(action.id);
    return (
      action.cooldown !== undefined && startedAt !== undefined && Date.now() - startedAt < action.cooldown
    );
  }

  private play(action: ActionDefinition): void {
    this.clearTimer();
    this.currentAction = action;
    this.lastStartedAt.set(action.id, Date.now());
    this.deps.renderer.playAction(action.animation);
    if (action.duration !== undefined) {
      this.completionTimer = setTimeout(() => this.complete(action), action.duration);
    }
    // Announce last: a listener may start another action, which replaces the timer above.
    this.deps.bus.emit("pet.action.started", { actionId: action.id });
  }

  private complete(action: ActionDefinition): void {
    this.completionTimer = null;
    this.currentAction = null;
    this.deps.bus.emit("pet.action.completed", { actionId: action.id });
    // A listener may already have started a follow-up action.
    if (this.currentAction === null) this.stop();
  }

  private clearTimer(): void {
    if (this.completionTimer !== null) {
      clearTimeout(this.completionTimer);
      this.completionTimer = null;
    }
  }
}
