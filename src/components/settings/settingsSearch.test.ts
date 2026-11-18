import { describe, expect, it } from "vitest";
import { FEATURE_GUIDE } from "../../guide/featureGuide";
import { FEATURE_COLORS, FEATURE_ICONS } from "../../guide/featureIcons";
import { isSection } from "./sections";
import { SEARCH_SKIPPED, SETTINGS_INDEX, searchSettings, type SearchEntry } from "./settingsSearch";

/** The settings components' source, to check the index against what the window shows. */
const FILES = import.meta.glob<string>(["./**/*.tsx", "!./**/*.test.tsx"], { query: "?raw", import: "default", eager: true });
const SOURCE = Object.values(FILES).join("\n");
/** Row and group titles written out in the components. */
const SHOWN_TITLES = new Set([...SOURCE.matchAll(/<(strong|h2|h3)\b[^>]*>([^<{]+)<\/\1>/g)].map((match) => match[2].trim()));

describe("settings search index", () => {
  it("only lists titles the settings window shows", () => {
    for (const { title } of SETTINGS_INDEX) {
      expect(SOURCE.includes(`>${title}<`) || SOURCE.includes(`"${title}"`), title).toBe(true);
    }
  });

  it("lists every row and group title, or skips it on purpose", () => {
    const listed = new Set([...SETTINGS_INDEX.map((entry) => entry.title), ...SEARCH_SKIPPED]);
    const missing = [...SHOWN_TITLES].filter((title) => !listed.has(title));
    expect(missing, "add these to SETTINGS_INDEX or SEARCH_SKIPPED in settingsSearch.ts").toEqual([]);
  });
});

describe("feature guide", () => {
  it("uses icons, colours and pages that exist", () => {
    for (const group of FEATURE_GUIDE) {
      expect(group.features.length).toBeGreaterThan(0);
      for (const feature of group.features) {
        expect(FEATURE_ICONS).toContain(feature.icon);
        expect(FEATURE_COLORS).toContain(feature.color);
        expect(feature.title.trim()).not.toBe("");
        expect(feature.detail.trim()).not.toBe("");
        if (feature.section !== undefined) expect(isSection(feature.section), feature.section).toBe(true);
      }
    }
  });

  it("gives every feature its own title, so search can scroll to it", () => {
    const titles = FEATURE_GUIDE.flatMap((group) => group.features.map((feature) => feature.title));
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("searchSettings", () => {
  const entries: SearchEntry[] = [
    { section: "general", title: "总在最前面", keywords: "置顶 全屏" },
    { section: "companion", title: "定时勿扰时照样深夜关心" },
    { section: "companion", title: "定时勿扰", keywords: "免打扰" },
    { section: "companion", title: "手动勿扰", keywords: "免打扰" },
  ];

  it("finds keywords as well as titles", () => {
    expect(searchSettings(entries, "置顶").map((entry) => entry.title)).toEqual(["总在最前面"]);
  });

  it("puts the exact title first, then titles that start with the query, shorter first", () => {
    expect(searchSettings(entries, "定时勿扰").map((entry) => entry.title)).toEqual(["定时勿扰", "定时勿扰时照样深夜关心"]);
    expect(searchSettings(entries, "勿扰").map((entry) => entry.title)).toEqual(["定时勿扰", "手动勿扰", "定时勿扰时照样深夜关心"]);
  });

  it("needs every word to match, ignoring case and spaces", () => {
    expect(searchSettings(entries, "免打扰 手动").map((entry) => entry.title)).toEqual(["手动勿扰"]);
    expect(searchSettings([{ section: "ai", title: "DeepSeek", keywords: "API Key" }], "apikey")).toHaveLength(1);
    expect(searchSettings(entries, "  ")).toEqual([]);
  });
});
