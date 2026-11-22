import { describe, expect, it } from "vitest";
import type { PetControl } from "../assets/Manifest";
import { createMemoryStorage, makeManifest } from "../testing/fixtures";
import { characterKey, CHARACTER_DATA } from "./CharacterPreferences";
import { APP_CONTROLS, BAR_SLOTS, barLayout, dockControls, loadDock, resetDock, saveDock, setDockAction, type DockItem } from "./DockPreferences";

const FOCUS: PetControl = { id: "focus", label: "专注", icon: "timer", command: "focus_toggle" };
const actions = makeManifest().animations;
const controls = dockControls([FOCUS]);
const ids = (items: DockItem[]) => items.map((item) => `${item.kind}:${item.id}${item.enabled ? "" : "(off)"}`);

describe("dock", () => {
  it("starts with the app buttons, then the character's", () => {
    expect(ids(loadDock("girl", controls, actions, createMemoryStorage()))).toEqual(["control:today", "control:notes", "control:focus", "control:coding(off)", "control:settings(off)"]);
    expect(APP_CONTROLS.map((control) => control.command)).toEqual(["today_open", "notes_open", "coding_open", "settings_open"]);
  });

  it("saves order, visibility, labels and actions together", () => {
    const storage = createMemoryStorage();
    const [today, notes, focus] = loadDock("girl", controls, actions, storage);
    const items: DockItem[] = [
      { ...focus, enabled: false },
      { kind: "action", id: "happy", enabled: true },
      today.kind === "control" ? { ...today, label: "待办" } : today,
      notes,
    ];
    saveDock("girl", items, storage);
    const loaded = loadDock("girl", controls, actions, storage);
    expect(ids(loaded)).toEqual(["control:focus(off)", "action:happy", "control:today", "control:notes", "control:coding(off)", "control:settings(off)"]);
    expect(loaded[2]).toMatchObject({ kind: "control", label: "待办" });
    expect(loadDock("cat", controls, actions, storage)).toHaveLength(5);
  });

  it("renames app buttons the user never renamed", () => {
    const storage = createMemoryStorage({
      [characterKey("girl", CHARACTER_DATA.dock)]: JSON.stringify([
        { kind: "control", id: "today", label: "今日", icon: "checklist", enabled: true },
        { kind: "control", id: "notes", label: "我的笔记", icon: "note", enabled: true },
      ]),
    });
    const [today, notes] = loadDock("girl", controls, actions, storage);
    expect(today).toMatchObject({ label: "提醒", icon: "bell" });
    expect(notes).toMatchObject({ label: "我的笔记" });
  });

  it("drops saved entries the character no longer has, the old chat button too, and appends new buttons", () => {
    const storage = createMemoryStorage({
      [characterKey("girl", CHARACTER_DATA.dock)]: JSON.stringify([
        { kind: "action", id: "missing", enabled: true },
        { kind: "action", id: "sleep", enabled: true },
        { kind: "control", id: "feed", label: "喂食", icon: "feed", enabled: true },
        { kind: "control", id: "chat", label: "聊天", icon: "chat", enabled: true },
      ]),
    });
    expect(ids(loadDock("girl", controls, actions, storage))).toEqual(["control:today", "control:notes", "control:focus", "control:coding(off)", "control:settings(off)"]);
  });

  it("keeps an empty label from being saved", () => {
    const storage = createMemoryStorage();
    const items = loadDock("girl", controls, actions, storage).map((item) => (item.kind === "control" ? { ...item, label: "  " } : item));
    saveDock("girl", items, storage);
    expect(loadDock("girl", controls, actions, storage)[0]).toMatchObject({ label: "提醒" });
  });

  it("moves the old focus settings and action shortcuts over", () => {
    const storage = createMemoryStorage({
      [characterKey("girl", CHARACTER_DATA.controlPreferences)]: JSON.stringify([{ id: "focus", label: "番茄", icon: "hourglass", enabled: false, order: 0 }]),
      [characterKey("girl", CHARACTER_DATA.actionShortcuts)]: JSON.stringify(["happy"]),
    });
    const items = loadDock("girl", controls, actions, storage);
    expect(ids(items)).toEqual(["control:today", "control:notes", "control:focus(off)", "action:happy", "control:coding(off)", "control:settings(off)"]);
    expect(items[2]).toMatchObject({ label: "番茄", icon: "hourglass" });
  });

  it("shows, hides and removes an action", () => {
    const base = loadDock("girl", controls, actions, createMemoryStorage());
    const added = setDockAction(base, "happy", true);
    expect(ids(added).slice(-1)[0]).toBe("action:happy");
    expect(ids(setDockAction(added, "happy", false)).slice(-1)[0]).toBe("action:happy(off)");
    expect(ids(setDockAction(setDockAction(added, "happy", false), "happy", true)).slice(-1)[0]).toBe("action:happy");
    expect(base).toHaveLength(5);
  });

  it("forgets every change on reset", () => {
    const storage = createMemoryStorage({ [characterKey("girl", CHARACTER_DATA.actionShortcuts)]: JSON.stringify(["happy"]) });
    saveDock("girl", [], storage);
    resetDock("girl", storage);
    expect(ids(loadDock("girl", controls, actions, storage))).toEqual(["control:today", "control:notes", "control:focus", "control:coding(off)", "control:settings(off)"]);
  });

  it("adds the coding and settings buttons turned off to a saved dock, and keeps it on once shown", () => {
    const storage = createMemoryStorage({
      [characterKey("girl", CHARACTER_DATA.dock)]: JSON.stringify([
        { kind: "control", id: "today", label: "提醒", icon: "bell", enabled: true },
        { kind: "control", id: "focus", label: "专注", icon: "timer", enabled: true },
      ]),
    });
    const items = loadDock("girl", controls, actions, storage);
    expect(ids(items)).toEqual(["control:today", "control:focus", "control:notes", "control:coding(off)", "control:settings(off)"]);
    saveDock("girl", items.map((item) => (item.id === "settings" ? { ...item, enabled: true } : item)), storage);
    expect(ids(loadDock("girl", controls, actions, storage)).slice(-1)[0]).toBe("control:settings");
  });
});

describe("bar layout", () => {
  const control = (id: string): DockItem => ({ kind: "control", id, label: id, icon: "bell", command: "today_open", enabled: true });
  const action = (id: string): DockItem => ({ kind: "action", id, enabled: true });
  const keys = (items: DockItem[]) => items.map((item) => item.id);

  it("puts every button on the bar while they fit and there are no actions", () => {
    const all = Array.from({ length: BAR_SLOTS }, (_, index) => control(`c${index}`));
    expect(barLayout(all)).toEqual({ bar: all, menu: [] });
  });

  it("keeps a place for the menu, which holds the actions and the buttons past the room", () => {
    const layout = barLayout([control("a"), action("wave"), control("b"), control("c"), control("d"), control("e")]);
    expect(keys(layout.bar)).toEqual(["a", "b", "c", "d"]);
    expect(keys(layout.menu)).toEqual(["e", "wave"]);
    expect(keys(barLayout(Array.from({ length: BAR_SLOTS + 1 }, (_, index) => control(`c${index}`))).menu)).toEqual(["c4", "c5"]);
  });
});
