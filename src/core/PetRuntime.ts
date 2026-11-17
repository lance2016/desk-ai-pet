import { loadAppearance } from "../appearance/AppearanceStore";
import { ActionController } from "../actions/ActionController";
import { ActionRegistry, IDLE_ACTION, toActionDefinition } from "../actions/ActionRegistry";
import { withUserActions, type UserAction } from "../actions/UserActions";
import type { AssetPack } from "../assets/AssetLoader";
import type { PetManifest } from "../assets/Manifest";
import { BehaviorEngine, type ReminderSource } from "../behavior/BehaviorEngine";
import { FocusTimer, restoreFocus, type FocusSnapshot } from "../behavior/FocusTimer";
import { loadDisabledIdleActions } from "../preferences/ActionPreferences";
import type { OpaqueMask, PetRenderer } from "../renderer/PetRenderer";
import type { PetStorage } from "../storage/PetStorage";
import type { ActionResult, HitRegion, PetEvents } from "../types";
import { EventBus } from "./EventBus";
import { createSnapshot, PetState } from "./PetState";

const TICK_INTERVAL_MS = 1000;
/**
 * Actions in this category mirror the pet's own state (idle, sleep, wake-up),
 * so outside callers may not trigger them directly.
 */
const SYSTEM_CATEGORY = "system";
/** Shortest time between two lines the pet says on its own, so it never chatters. */
const PROACTIVE_GAP_MS = 20 * 60_000;

interface RuntimeOptions {
  renderer: PetRenderer;
  storage: PetStorage;
  /** The character to show, already loaded (see `loadCharacterPack`). */
  pack: AssetPack;
  reminders?: ReminderSource;
  /** True while the pet should not speak up on its own (do-not-disturb or quiet hours). */
  isQuiet?: (now: number) => boolean;
  /** True while reminders should wait on the badge: only the user's own do-not-disturb. */
  holdsReminders?: (now: number) => boolean;
  /** Where the running focus round is kept, so a restart or a character switch keeps it. */
  focusStore?: { load(): FocusSnapshot | null; save(snapshot: FocusSnapshot): void };
  /** The actions the user made for this character, read again whenever one changes. */
  userActions?: () => UserAction[];
}

/** Wires the modules together and owns their lifetime. */
export class PetRuntime {
  readonly bus = new EventBus<PetEvents>();
  readonly registry = new ActionRegistry();
  readonly state: PetState;
  readonly focus: FocusTimer;
  private readonly controller: ActionController;
  private readonly behavior: BehaviorEngine;
  private readonly tickTimer: ReturnType<typeof setInterval>;
  private readonly stopSaving: () => void;
  private readonly stopMirroring: () => void;
  private readonly isQuiet: (now: number) => boolean;
  private readonly userActions: () => UserAction[];
  private lastProactiveAt: number | null = null;
  /** The pack's manifest plus the user's actions; replaced whenever those change. */
  private currentManifest: PetManifest;

  private constructor(
    /** The manifest as the asset pack ships it. */
    private readonly packManifest: PetManifest,
    manifest: PetManifest,
    readonly resolveAsset: (file: string) => string,
    private readonly renderer: PetRenderer,
    availableAnimations: ReadonlySet<string>,
    storage: PetStorage,
    { reminders, isQuiet, holdsReminders, focusStore, userActions }: Pick<RuntimeOptions, "reminders" | "isQuiet" | "holdsReminders" | "focusStore" | "userActions">,
  ) {
    this.currentManifest = manifest;
    this.focus = new FocusTimer(restoreFocus(focusStore?.load() ?? null, Date.now()), focusStore?.save);
    this.isQuiet = isQuiet ?? (() => false);
    this.userActions = userActions ?? (() => []);
    this.registry.registerManifest(manifest, availableAnimations);
    this.state = new PetState(createSnapshot(Date.now(), storage.loadPet() ?? undefined));
    this.controller = new ActionController({ registry: this.registry, renderer, bus: this.bus });
    this.behavior = new BehaviorEngine({
      bus: this.bus,
      state: this.state,
      controller: this.controller,
      registry: this.registry,
      focus: this.focus,
      isIdleActionEnabled: (id) => !loadDisabledIdleActions(packManifest.id).includes(id),
      reminders,
      holdsReminders,
    });

    let savedStats = this.state.get().stats;
    this.stopSaving = this.state.subscribe((snapshot) => {
      if (snapshot.stats === savedStats) return;
      savedStats = snapshot.stats;
      storage.savePet({ stats: snapshot.stats, savedAt: snapshot.updatedAt });
    });

    // Peek art is drawn hiding on the left; on the right edge it is shown mirrored.
    this.stopMirroring = this.bus.on("pet.dock_changed", ({ side }) => renderer.setMirrored(side === "right"));

    this.controller.stop();
    this.behavior.start();
    this.tickTimer = setInterval(() => {
      const now = Date.now();
      this.state.advance(now);
      this.behavior.tick(now);
    }, TICK_INTERVAL_MS);
  }

  static async create({ renderer, storage, pack, ...options }: RuntimeOptions): Promise<PetRuntime> {
    const manifest = withUserActions(pack.manifest, options.userActions?.() ?? []);
    const available = await renderer.loadAssetPack({ ...pack, manifest });
    if (!available.has(IDLE_ACTION)) {
      throw new Error(`Asset pack "${pack.manifest.id}" has no usable "${IDLE_ACTION}" animation`);
    }
    if (typeof indexedDB !== "undefined") {
      await Promise.all(manifest.animations.filter((entry) => available.has(entry.id)).map(async (entry) => {
        try {
          const appearance = await loadAppearance(pack.manifest.id, entry.id);
          if (appearance) await renderer.setAppearance(entry.id, appearance);
        } catch (error) { console.warn(`Failed to restore appearance for ${entry.id}`, error); }
      }));
    }
    return new PetRuntime(pack.manifest, manifest, pack.resolve, renderer, available, storage, options);
  }

  get manifest(): PetManifest {
    return this.currentManifest;
  }

  /**
   * The single entry point for anything outside the pet (a future AI module,
   * for example) to trigger an action. It cannot change stats or skip scheduling.
   */
  requestAction(id: string): ActionResult {
    const action = this.registry.resolve(id);
    if (action && action.category === SYSTEM_CATEGORY && action.id !== IDLE_ACTION) {
      return { accepted: false, reason: "restricted" };
    }
    return this.controller.request(id);
  }

  /** Shows a short line in the speech bubble. Like `requestAction`, it cannot change stats. */
  say(text: string): void {
    const line = text.trim();
    if (line) this.bus.emit("pet.say", { text: line });
  }

  /**
   * For lines the pet starts on its own rather than in answer to the user
   * (greetings, small talk). Dropped while it is quiet or when the pet spoke up
   * recently. Returns whether the line was shown.
   */
  sayProactively(text: string): boolean {
    if (!this.allowProactive(text)) return false;
    this.say(text);
    return true;
  }

  /**
   * Like `sayProactively`, but the pet also comes out to meet the user: it
   * wakes up, leaves the screen edge and cheers. For morning and evening greetings.
   */
  greet(text: string): boolean {
    if (!this.allowProactive(text)) return false;
    this.bus.emit("pet.greeting", { text: text.trim() });
    return true;
  }

  /** Checks quiet time and the gap since the last proactive line, and claims the slot. */
  private allowProactive(text: string): boolean {
    const now = Date.now();
    if (!text.trim() || this.isQuiet(now)) return false;
    if (this.lastProactiveAt !== null && now - this.lastProactiveAt < PROACTIVE_GAP_MS) return false;
    this.lastProactiveAt = now;
    return true;
  }

  /** Shows a small status next to the pet, or hides it with `null`. */
  setBadge(text: string | null): void {
    this.bus.emit("pet.badge", { text: text?.trim() || null });
  }

  /**
   * Shows an action's new picture. The action may also be one the user just
   * made or deleted, so the user's actions are read again first.
   */
  async refreshAppearance(id: string): Promise<void> {
    const removed = await this.syncUserActions();
    if (removed.includes(id)) return;
    if (!this.manifest.animations.some((action) => action.id === id)) throw new Error("Unknown action");
    const appearance = await loadAppearance(this.manifest.id, id);
    await this.renderer.setAppearance(id, appearance);
    this.bus.emit("pet.appearance.changed", {});
  }

  /** Brings the user's actions in line with storage. Returns the ids that were removed. */
  private async syncUserActions(): Promise<string[]> {
    const next = withUserActions(this.packManifest, this.userActions());
    const nextIds = new Set(next.animations.map((entry) => entry.id));
    const removed = this.currentManifest.animations.filter((entry) => !nextIds.has(entry.id)).map((entry) => entry.id);
    const known = new Set(this.currentManifest.animations.map((entry) => entry.id));
    const failed = new Set<string>();
    for (const entry of next.animations) {
      if (this.packManifest.animations.includes(entry)) continue;
      if (!known.has(entry.id) && !(await this.renderer.addAnimation(entry))) {
        failed.add(entry.id);
        continue;
      }
      // Registering again picks up a new name or length.
      this.registry.register(toActionDefinition(entry));
    }
    for (const id of removed) {
      if (this.controller.current?.id === id) this.controller.stop();
      this.registry.unregister(id);
      this.renderer.removeAnimation(id);
    }
    this.currentManifest = { ...next, animations: next.animations.filter((entry) => !failed.has(entry.id)) };
    this.bus.emit("pet.actions.changed", {});
    return removed;
  }

  hitTest(x: number, y: number): HitRegion | null {
    return this.renderer.hitTest(x, y);
  }

  resize(width: number, height: number): void {
    this.renderer.resize(width, height);
  }

  opaqueMask(cell: number): OpaqueMask | null {
    return this.renderer.opaqueMask(cell);
  }

  destroy(): void {
    clearInterval(this.tickTimer);
    this.stopSaving();
    this.stopMirroring();
    this.behavior.stop();
    this.controller.dispose();
    this.renderer.destroy();
  }
}
