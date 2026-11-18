import { describe, expect, it } from "vitest";
import { MANIFEST_JSON } from "../testing/fixtures";
import { parseManifest } from "./Manifest";

const withAnimation = (animation: unknown) => ({ ...MANIFEST_JSON, animations: [animation] });

describe("parseManifest", () => {
  it("fills in defaults for optional fields", () => {
    const manifest = parseManifest(withAnimation({ id: "dance", file: "animations/dance.png" }));
    expect(manifest.scale).toBe(1);
    expect(manifest.headArea).toEqual({ x: 0, y: 0, width: 1, height: 0.5 });
    expect(manifest.animations[0]).toEqual({
      id: "dance",
      file: "animations/dance.png",
      frames: 1,
      fps: 12,
      loop: false,
      motion: "none",
      motionSpeed: 1,
      motionStrength: 1,
      align: "center",
      layers: [],
      category: "reaction",
      priority: 10,
      interruptible: true,
    });
  });

  it("keeps the motion speed and strength supplied by a character pack", () => {
    const manifest = parseManifest(withAnimation({ id: "dance", file: "animations/dance.png", motionSpeed: 2, motionStrength: 0.5 }));
    expect(manifest.animations[0]).toMatchObject({ motionSpeed: 2, motionStrength: 0.5 });
  });

  it.each(["../secret.png", "/etc/passwd", "https://example.com/a.png", "a\\b.png", "a/../../b.png"])(
    "rejects the asset path %s",
    (file) => {
      expect(() => parseManifest(withAnimation({ id: "x", file }))).toThrow(/Invalid pet manifest/);
    },
  );

  it("rejects an unknown motion", () => {
    expect(() => parseManifest(withAnimation({ id: "x", file: "x.png", motion: "explode" }))).toThrow(
      /Invalid pet manifest/,
    );
  });

  it("rejects an unknown alignment", () => {
    expect(() => parseManifest(withAnimation({ id: "x", file: "x.png", align: "top" }))).toThrow(
      /Invalid pet manifest/,
    );
  });

  it("rejects duplicate animation ids", () => {
    const entry = { id: "idle", file: "idle.png" };
    expect(() => parseManifest({ ...MANIFEST_JSON, animations: [entry, entry] })).toThrow(/duplicate animation id "idle"/);
  });

  it("accepts an optional persona and rejects an unknown voice", () => {
    const persona = { name: "阿橘", personality: "慵懒", voice: "茉莉", voiceStyle: "轻柔" };
    expect(parseManifest({ ...MANIFEST_JSON, persona }).persona).toEqual(persona);
    expect(parseManifest(MANIFEST_JSON).persona).toBeUndefined();
    expect(() => parseManifest({ ...MANIFEST_JSON, persona: { ...persona, voice: "robot" } })).toThrow(/Invalid pet manifest/);
  });

  it("rejects a manifest without animations", () => {
    expect(() => parseManifest({ ...MANIFEST_JSON, animations: [] })).toThrow(/Invalid pet manifest/);
    expect(() => parseManifest(null)).toThrow(/Invalid pet manifest/);
  });
});
