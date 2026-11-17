import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage, MANIFEST_JSON } from "../testing/fixtures";
import { createCustomCharacter, deleteCustomCharacter, isCustomCharacter, loadCharacterPack, loadCustomCharacters, loadPackCatalog } from "./PackCatalog";

afterEach(() => vi.unstubAllGlobals());

function serve(files: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url in files ? new Response(JSON.stringify(files[url])) : new Response("", { status: 404 })));
}

describe("pack catalog", () => {
  it("lists loadable characters by their persona name and skips broken ones", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    serve({
      "/pets/index.json": { packs: ["test-pet", "missing"] },
      "/pets/test-pet/manifest.json": { ...MANIFEST_JSON, persona: { name: "阿橘" } },
    });
    const [entry, ...rest] = await loadPackCatalog(createMemoryStorage());
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ id: "test-pet", name: "阿橘", custom: false });
    expect(entry.actionImages.idle).toBe("/pets/test-pet/a/idle.png");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("rejects ids that are not plain directory names", async () => {
    serve({ "/pets/index.json": { packs: ["../secret"] } });
    await expect(loadPackCatalog()).rejects.toThrow();
  });

  it("requires the manifest id to match its directory", async () => {
    serve({ "/pets/other/manifest.json": MANIFEST_JSON });
    await expect(loadCharacterPack("other")).rejects.toThrow(/does not match/);
  });

});

describe("custom characters", () => {
  const files = { "/pets/index.json": { packs: ["test-pet"] }, "/pets/test-pet/manifest.json": { ...MANIFEST_JSON, persona: { name: "阿橘", personality: "慵懒" } } };

  it("borrows the looks of a built-in character under its own id and persona", async () => {
    serve(files);
    const storage = createMemoryStorage();
    const created = createCustomCharacter({ base: "test-pet", name: " 小黑 ", personality: "高冷" }, storage, 5, "custom-abc123");
    expect(created).toEqual({ id: "custom-abc123", base: "test-pet", name: "小黑", personality: "高冷", createdAt: 5 });
    expect(isCustomCharacter(created.id)).toBe(true);
    const pack = await loadCharacterPack(created.id, storage);
    expect(pack.manifest.id).toBe("custom-abc123");
    expect(pack.manifest.persona).toMatchObject({ name: "小黑", personality: "高冷" });
    expect(pack.resolve("a/idle.png")).toBe("/pets/test-pet/a/idle.png");
    expect((await loadPackCatalog(storage)).map((entry) => [entry.id, entry.name, entry.custom])).toEqual([["test-pet", "阿橘", false], ["custom-abc123", "小黑", true]]);
  });

  it("rejects bad input and forgets deleted characters", async () => {
    serve(files);
    const storage = createMemoryStorage();
    expect(() => createCustomCharacter({ base: "test-pet", name: "  ", personality: "" }, storage)).toThrow();
    expect(() => createCustomCharacter({ base: "../x", name: "坏", personality: "" }, storage)).toThrow();
    createCustomCharacter({ base: "test-pet", name: "小黑", personality: "" }, storage, 1, "custom-abc123");
    deleteCustomCharacter("custom-abc123", storage);
    expect(loadCustomCharacters(storage)).toEqual([]);
    await expect(loadCharacterPack("custom-abc123", storage)).rejects.toThrow(/Unknown character/);
  });

  it("ignores an unreadable list", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(loadCustomCharacters(createMemoryStorage({ "ai-pet:custom-characters:v1": "{" }))).toEqual([]);
    warn.mockRestore();
  });
});
