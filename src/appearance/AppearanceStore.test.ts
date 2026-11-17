import { describe, expect, it } from "vitest";
import { appearanceLayerSchema, appearanceSchema } from "./AppearanceStore";

const valid = { image: "data:image/png;base64,aGVsbG8=", frames: 4, fps: 8, motion: "sway" as const, motionSpeed: 1, motionStrength: 1, loop: true };

describe("action appearance validation", () => {
  it("accepts a supported local frame sheet", () => {
    expect(appearanceSchema.parse(valid)).toEqual(valid);
  });
  it.each([
    { ...valid, image: "https://example.com/a.png" },
    { ...valid, frames: 0 },
    { ...valid, frames: 17 },
    { ...valid, fps: 0 },
    { ...valid, fps: 31 },
    { ...valid, motion: "unknown" },
  ])("rejects unsafe or unsupported settings", (value) => {
    expect(appearanceSchema.safeParse(value).success).toBe(false);
  });

  it("accepts a custom layer and preserves old records without layers", () => {
    const layer = { source: { image: "data:image/png;base64,aGVsbG8=" }, frames: 1, fps: 12, x: 10, y: -30, scaleX: 1, scaleY: 1, rotation: 0, zIndex: 1, motion: "none", startFrame: 2, endFrame: 3 };
    expect(appearanceSchema.safeParse({ ...valid, layers: [layer] }).success).toBe(true);
    expect(appearanceSchema.parse(valid).layers).toBeUndefined();
    expect(appearanceSchema.safeParse({ ...valid, layers: [{ ...layer, endFrame: 5 }] }).success).toBe(false);
  });

  it("rejects external layer paths and reversed frame ranges", () => {
    const layer = { source: { file: "../outside.png" }, frames: 1, fps: 12, x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, zIndex: 1, motion: "none", startFrame: 3, endFrame: 2 };
    expect(appearanceLayerSchema.safeParse(layer).success).toBe(false);
  });
});

describe("appearance storage", () => {
  it("keeps overrides isolated by pack and action and can restore defaults", async () => {
    const { vi } = await import("vitest");
    const records = new Map<string, unknown>();
    const database = {
      createObjectStore: () => ({}),
      close: () => {},
      transaction: () => {
        const transaction: { oncomplete?: () => void; objectStore: () => unknown } = {
          objectStore: () => {
            const perform = (operation: () => unknown) => {
              const request: { result?: unknown; onsuccess?: () => void } = {};
              queueMicrotask(() => { request.result = operation(); request.onsuccess?.(); queueMicrotask(() => transaction.oncomplete?.()); });
              return request;
            };
            return {
              get: (key: string) => perform(() => records.get(key)),
              put: (value: unknown, key: string) => perform(() => { records.set(key, value); return key; }),
              delete: (key: string) => perform(() => { records.delete(key); }),
            };
          },
        };
        return transaction;
      },
    };
    vi.stubGlobal("indexedDB", { open: () => {
      const request: { result: typeof database; onupgradeneeded?: () => void; onsuccess?: () => void } = { result: database };
      queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    } });
    try {
      const { saveAppearance, loadAppearance, resetAppearance } = await import("./AppearanceStore");
      await saveAppearance("pack-a", "happy", valid);
      expect(await loadAppearance("pack-a", "happy")).toEqual(valid);
      expect(await loadAppearance("pack-b", "happy")).toBeNull();
      expect(await loadAppearance("pack-a", "sleep")).toBeNull();
      await resetAppearance("pack-a", "happy");
      expect(await loadAppearance("pack-a", "happy")).toBeNull();
    } finally { vi.unstubAllGlobals(); }
  });
});
