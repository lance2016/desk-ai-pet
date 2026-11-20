import { describe, expect, it } from "vitest";
import { ACCOUNT_SECTION, DEVELOPER_GROUP, NAV_GROUPS, SECTIONS, SUB_PAGES } from "./sections";

describe("settings navigation", () => {
  it("groups user settings by what they help the user do", () => {
    expect(NAV_GROUPS.map(({ title, items }) => [title, items.map(({ id }) => id)])).toEqual([
      ["角色与外观", ["actions", "dock"]],
      ["聊天与 AI", ["chat", "ai", "memory", "voice"]],
      ["陪伴与工具", ["companion", "tools"]],
      ["应用", ["general", "privacy", "guide"]],
    ]);
  });

  it("includes every top-level page once and keeps secondary pages separate", () => {
    const ids = [ACCOUNT_SECTION, ...NAV_GROUPS.flatMap(({ items }) => items.map(({ id }) => id))];
    const subPages = Object.keys(SUB_PAGES);
    const expected = SECTIONS.filter((id) => id !== "developer" && !subPages.includes(id));

    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...expected].sort());
    expect(DEVELOPER_GROUP.items.map(({ id }) => id)).toEqual(["developer"]);
  });

  it("places character details under Characters and diagnostics under General", () => {
    expect(SUB_PAGES).toEqual({ characterProfile: "character", about: "general", diagnostics: "about" });
  });
});
