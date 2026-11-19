import { parseManifest, type PetManifest } from "../assets/Manifest";
import type { PetRenderer } from "../renderer/PetRenderer";
import type { ChatRequestPreferences } from "../preferences/ChatPreferences";
import type { ChatContext } from "../ai/types";

/** A small pack covering every kind of action the logic distinguishes. */
export const MANIFEST_JSON = {
  id: "test-pet",
  name: "Test Pet",
  version: "1.0.0",
  canvas: { width: 100, height: 100 },
  animations: [
    { id: "idle", file: "a/idle.png", loop: true, category: "system", priority: 0 },
    { id: "blink", file: "a/idle.png", duration: 400, category: "idle", priority: 5 },
    { id: "happy", file: "a/happy.png", duration: 1800, priority: 20, cooldown: 500 },
    { id: "pet_reaction", file: "a/pet.png", duration: 2000, priority: 20, cooldown: 500 },
    { id: "shy", file: "a/pet.png", duration: 1600, priority: 25 },
    { id: "eat", file: "a/eat.png", duration: 2400, priority: 30, cooldown: 3000, fallback: "happy" },
    { id: "wooden_fish", file: "a/wooden_fish.png", duration: 4000, priority: 30 },
    { id: "focus", file: "a/idle.png", loop: true, category: "system", priority: 15 },
    { id: "sleep", file: "a/sleep.png", loop: true, category: "system", priority: 50 },
    { id: "peek", file: "a/peek.png", loop: true, align: "left", category: "system", priority: 55 },
    { id: "wake_up", file: "a/idle.png", duration: 900, category: "system", priority: 60, interruptible: false },
    { id: "drag", file: "a/drag.png", loop: true, category: "system", priority: 70 },
  ],
};

export function makeManifest(extraAnimations: unknown[] = []): PetManifest {
  return parseManifest({ ...MANIFEST_JSON, animations: [...MANIFEST_JSON.animations, ...extraAnimations] });
}

export function animationIds(manifest: PetManifest, except: string[] = []): Set<string> {
  return new Set(manifest.animations.map((animation) => animation.id).filter((id) => !except.includes(id)));
}

/** Records what the logic asked the renderer to do. */
export class FakeRenderer implements PetRenderer {
  readonly played: string[] = [];
  stopped = 0;
  mirrored = false;
  destroyed = false;

  constructor(private readonly missing: string[] = []) {}

  async loadAssetPack(pack: { manifest: PetManifest }): Promise<ReadonlySet<string>> {
    return animationIds(pack.manifest, this.missing);
  }
  async setAppearance(): Promise<void> {}
  async addAnimation(): Promise<boolean> {
    return true;
  }
  removeAnimation(): void {}
  playAction(animationId: string): void {
    this.played.push(animationId);
  }
  stopAction(): void {
    this.stopped += 1;
  }
  setMirrored(mirrored: boolean): void {
    this.mirrored = mirrored;
  }
  resize(): void {}
  hitTest(): null {
    return null;
  }
  opaqueMask(): null {
    return null;
  }
  destroy(): void {
    this.destroyed = true;
  }

  get last(): string | undefined {
    return this.played[this.played.length - 1];
  }
}

export function createMemoryStorage(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

/** Chat preferences as `requestPreferences` returns them. */
export function chatPreferences(overrides: Partial<ChatRequestPreferences> = {}): ChatRequestPreferences {
  return { name: "小艾", personality: "温柔", length: "short", userName: "", model: "deepseek-flash", instructions: "", rules: {}, record: false, ...overrides };
}

/** What `chatContext` sends with a chat request. */
export function chatRequestContext(overrides: Partial<ChatContext> = {}): ChatContext {
  return { now: "2026-11-18 21:51 周三", timestamp: "2026-11-18T21:51:00+08:00", timeZone: "Asia/Shanghai", actions: ["wave"], ...overrides };
}
