import { describe, expect, it } from "vitest";
import { ACCOUNT_SECTION, DEVELOPER_GROUP, NAV_GROUPS, SECTIONS, SUB_PAGES } from "./sections";

describe("settings navigation", () => {
  it("groups user settings by what they help the user do", () => {
    expect(NAV_GROUPS.map(({ title, items }) => [title, items.map(({ id }) => id)])).toEqual([
      ["宠物", ["actions", "dock"]],
      ["对话", ["chat", "skills", "memory", "ai"]],
      ["陪伴与工具", ["companion", "tools"]],
      ["应用", ["general", "privacy", "guide", "about"]],
    ]);
  });

  it("includes every top-level page once and keeps secondary pages separate", () => {
    const ids = [ACCOUNT_SECTION, ...NAV_GROUPS.flatMap(({ items }) => items.map(({ id }) => id))];
    const subPages = Object.keys(SUB_PAGES);
    const developer: readonly string[] = DEVELOPER_GROUP.items.map(({ id }) => id);
    const expected = SECTIONS.filter((id) => !developer.includes(id) && !subPages.includes(id));

    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...expected].sort());
    expect(developer).toEqual(["prompt", "toolDefs", "developer"]);
  });

  it("places character details under Characters, diagnostics under About, cloned voices under AI, and links under Tools", () => {
    expect(SUB_PAGES).toEqual({ characterProfile: "character", diagnostics: "about", voices: "ai", links: "tools" });
  });
});
