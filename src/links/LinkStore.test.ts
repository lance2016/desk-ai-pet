import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { linksByGroup, linkSchema, loadLinks, moveLink, moveLinkGroup, updateLinks, type WorkLink } from "./LinkStore";

const dev = { id: "74c77a45-f065-485f-9448-daca7be12344", name: "API 文档", url: "http://localhost:1420/docs", group: "AiMe", tag: "DEV", description: "" };
const qa = { id: "c845d5f6-c78e-4f6d-b799-a4d1feebbe6c", name: "API 文档", url: "https://docs.example.test/api", group: "AiMe", tag: "TEST", description: "机器人功能验收" };
const logs = { id: "72ab551c-0339-4a25-a138-f7abc37fb2cf", name: "Phoenix", url: "https://logs.example.test", group: "工作台", tag: "", description: "" };

describe("saved links", () => {
  it("finds same-named environments by tag, address and group", () => {
    expect(linksByGroup([dev, qa, logs], "aime test").get("AiMe")).toEqual([qa]);
    expect(linksByGroup([dev, qa, logs], "localhost API").get("AiMe")).toEqual([dev]);
    expect(linksByGroup([dev, qa, logs], "功能验收").get("AiMe")).toEqual([qa]);
  });

  it("loads links saved before descriptions were added", () => {
    const { description: _description, ...legacy } = dev;
    const storage = createMemoryStorage({ "ai-pet:links:v1": JSON.stringify([legacy]) });
    expect(loadLinks(storage)).toEqual([dev]);
  });

  it("opens only HTTP or HTTPS URLs and accepts internal addresses", () => {
    expect(linkSchema.parse({ ...dev, url: " HTTP://localhost:1420/docs " }).url).toBe(dev.url);
    for (const url of ["file:///tmp/test", "javascript:alert(1)", "https://user:pass@example.test", "http://"]) {
      expect(linkSchema.safeParse({ ...dev, url }).success).toBe(false);
    }
  });

  it("keeps group order and saves a dragged link in its destination group", () => {
    const storage = createMemoryStorage();
    updateLinks(() => [dev, logs, qa], storage);
    const order = (links: WorkLink[]) => [...linksByGroup(links).values()].map((group) => group.map(({ id }) => id));
    expect(order(loadLinks(storage))).toEqual([[dev.id, qa.id], [logs.id]]);
    updateLinks((links) => moveLinkGroup(links, "工作台", -1), storage);
    updateLinks((links) => moveLink(links, qa.id, logs.id), storage);
    expect(order(loadLinks(storage))).toEqual([[qa.id, logs.id], [dev.id]]);
    expect(loadLinks(storage)[0].group).toBe("工作台");
  });
});
