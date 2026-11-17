import { afterEach, describe, expect, it, vi } from "vitest";
import { MANIFEST_JSON } from "../testing/fixtures";
import { loadAssetPack } from "./AssetLoader";

afterEach(() => vi.unstubAllGlobals());

describe("loadAssetPack", () => {
  it("reads the manifest and resolves files relative to the pack", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(MANIFEST_JSON)));
    vi.stubGlobal("fetch", fetchMock);

    const pack = await loadAssetPack("/pets/test-pet");

    expect(fetchMock).toHaveBeenCalledWith("/pets/test-pet/manifest.json");
    expect(pack.manifest.id).toBe("test-pet");
    expect(pack.resolve("a/idle.png")).toBe("/pets/test-pet/a/idle.png");
  });

  it("fails clearly when the manifest cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(loadAssetPack("/pets/missing/")).rejects.toThrow(/HTTP 404/);
  });
});
