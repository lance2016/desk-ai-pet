import { describe, expect, it } from "vitest";
import { makeManifest } from "../testing/fixtures";
import { buildArtPrompt } from "./ArtPrompt";

describe("buildArtPrompt", () => {
  it("lists every pack action in manifest order with its pose", () => {
    const manifest = makeManifest([{ id: "wave", file: "a/wave.png", label: "挥手", pose: "站着挥手。" }]);
    const prompt = buildArtPrompt(manifest.animations);
    const lines = prompt.split("\n");

    expect(prompt).toContain(`共 ${manifest.animations.length} 张`);
    expect(lines).toContain("1. idle：表现「idle」的样子。");
    expect(lines).toContain(`${manifest.animations.length}. 挥手：站着挥手。`);
  });

  it("leaves out the user's own actions", () => {
    const manifest = makeManifest([{ id: "my-abcdef", file: "a/idle.png", label: "转圈圈", category: "custom" }]);
    const prompt = buildArtPrompt(manifest.animations);

    expect(prompt).not.toContain("转圈圈");
    expect(prompt).toContain(`共 ${manifest.animations.length - 1} 张`);
  });
});
