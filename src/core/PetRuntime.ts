import { loadAppearance, type ActionAppearance } from "../appearance/AppearanceStore";
import { borrowedAppearance, hasOwnLook, planLooks } from "../appearance/looks";
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

/**
 * Shows every action's picture: the user's own, the pack's, or one borrowed
 * from another action (see `planLooks`). `shown` remembers what each action
 * shows, so only what changed is loaded again; `changed` names the action whose
 * picture the user just replaced. Returns the actions that cannot play for want of a picture.
 */
async function showLooks(renderer: PetRenderer, manifest: PetManifest, loaded: ReadonlySet<string>, shown: Map<string, string>, changed?: string): Promise<Set<string>> {
  const entries = manifest.animations.filter((entry) => loaded.has(entry.id));
  const pictures = new Map<string, ActionAppearance>();
  if (typeof indexedDB !== "undefined") {
    await Promise.all(entries.map(async (entry) => {
      try {
        const picture = await loadAppearance(manifest.id, entry.id);
        if (picture) pictures.set(entry.id, picture);
      } catch (error) {
        if (entry.id === changed) throw error;
        console.warn(`Failed to read the picture of ${entry.id}`, error);
      }
    }));
  }
  const drawn = new Set(pictures.keys());
  const looks = planLooks(entries, drawn, hasOwnLook(manifest.id, drawn));
  const unplayable = new Set<string>();
  await Promise.all(entries.map(async (entry) => {
    const { source, playable } = looks.get(entry.id) ?? { source: entry.id, playable: true };
    if (!playable) unplayable.add(entry.id);
    const picture = pictures.get(source);
    const look = `${source}:${picture ? "user" : "pack"}`;
    // Fresh from the pack, an action shows its own picture or the one the pack borrowed for it.
    const before = shown.get(entry.id) ?? `${entry.borrowedFrom ?? entry.id}:pack`;
    if (look === before && entry.id !== changed && source !== changed) return;
    try {
      await renderer.setAppearance(entry.id, !picture ? null : source === entry.id ? picture : borrowedAppearance(entry, picture));
      shown.set(entry.id, look);
    } catch (error) {
      if (entry.id === changed) throw error;
      console.warn(`Failed to show the picture of ${entry.id}`, error);
    }
  }));
  return unplayable;
}

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
    /** Animations the renderer has loaded; the user's own actions join and leave it. */
    private readonly loaded: Set<string>,
    unplayable: ReadonlySet<string>,
    /** What each action shows, as `showLooks` left it. */
    private readonly shown: Map<string, string>,
    storage: PetStorage,
    { reminders, isQuiet, holdsReminders, focusStore, userActions }: Pick<RuntimeOptions, "reminders" | "isQuiet" | "holdsReminders" | "focusStore" | "userActions">,
  ) {
    this.currentManifest = manifest;
    this.focus = new FocusTimer(restoreFocus(focusStore?.load() ?? null, Date.now()), focusStore?.save);
    this.isQuiet = isQuiet ?? (() => false);
    this.userActions = userActions ?? (() => []);
    this.registry.registerManifest(manifest, new Set([...loaded].filter((id) => !unplayable.has(id))));
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
    const loaded = new Set(available);
    const shown = new Map<string, string>();
    const unplayable = await showLooks(renderer, manifest, loaded, shown);
    return new PetRuntime(pack.manifest, manifest, pack.resolve, renderer, loaded, unplayable, shown, storage, options);
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
  greet(text: string, allowQuiet = false): boolean {
    if (!this.allowProactive(text, allowQuiet)) return false;
    this.bus.emit("pet.greeting", { text: text.trim() });
    return true;
  }

  /** Checks quiet time and the gap since the last proactive line, and claims the slot. */
  private allowProactive(text: string, allowQuiet = false): boolean {
    const now = Date.now();
    if (!text.trim() || (!allowQuiet && this.isQuiet(now))) return false;
    if (this.lastProactiveAt !== null && now - this.lastProactiveAt < PROACTIVE_GAP_MS) return false;
    this.lastProactiveAt = now;
    return true;
  }

  /**
   * Shows an action's new picture. The action may also be one the user just
   * made or deleted, so the user's actions are read again first.
   */
  async refreshAppearance(id: string): Promise<void> {
    const removed = await this.syncUserActions();
    if (removed.includes(id)) return;
    if (!this.manifest.animations.some((action) => action.id === id)) throw new Error("Unknown action");
    // One new picture can change others: actions borrowing it, or all of them once the character has its own idle.
    const unplayable = await showLooks(this.renderer, this.manifest, this.loaded, this.shown, id);
    for (const entry of this.manifest.animations) {
      if (!this.loaded.has(entry.id)) continue;
      if (unplayable.has(entry.id)) this.registry.unregister(entry.id);
      else if (!this.registry.has(entry.id)) this.registry.register(toActionDefinition(entry));
    }
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
      this.loaded.add(entry.id);
      // Registering again picks up a new name or length.
      this.registry.register(toActionDefinition(entry));
    }
    for (const id of removed) {
      if (this.controller.current?.id === id) this.controller.stop();
      this.registry.unregister(id);
      this.renderer.removeAnimation(id);
      this.loaded.delete(id);
      this.shown.delete(id);
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
