import { describe, expect, it } from "vitest";
import type { PetControl } from "../assets/Manifest";
import { createMemoryStorage, makeManifest } from "../testing/fixtures";
import { characterKey, CHARACTER_DATA } from "./CharacterPreferences";
import { APP_CONTROLS, dockControls, loadDock, resetDock, saveDock, setDockAction, type DockItem } from "./DockPreferences";

const FOCUS: PetControl = { id: "focus", label: "专注", icon: "timer", command: "focus_toggle" };
const actions = makeManifest().animations;
const controls = dockControls([FOCUS]);
const ids = (items: DockItem[]) => items.map((item) => `${item.kind}:${item.id}${item.enabled ? "" : "(off)"}`);

describe("dock", () => {
  it("starts with the app buttons, then the character's", () => {
    expect(ids(loadDock("girl", controls, actions, createMemoryStorage()))).toEqual(["control:chat", "control:today", "control:notes", "control:focus"]);
    expect(APP_CONTROLS.map((control) => control.command)).toEqual(["chat_open", "today_open", "notes_open"]);
  });

  it("saves order, visibility, labels and actions together", () => {
    const storage = createMemoryStorage();
    const [chat, today, notes, focus] = loadDock("girl", controls, actions, storage);
    const items: DockItem[] = [
      { ...focus, enabled: false },
      chat,
      { kind: "action", id: "happy", enabled: true },
      today.kind === "control" ? { ...today, label: "待办" } : today,
      notes,
    ];
    saveDock("girl", items, storage);
    const loaded = loadDock("girl", controls, actions, storage);
    expect(ids(loaded)).toEqual(["control:focus(off)", "control:chat", "action:happy", "control:today", "control:notes"]);
    expect(loaded[3]).toMatchObject({ kind: "control", label: "待办" });
    expect(loadDock("cat", controls, actions, storage)).toHaveLength(4);
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

  it("drops saved entries the character no longer has and appends new buttons", () => {
    const storage = createMemoryStorage({
      [characterKey("girl", CHARACTER_DATA.dock)]: JSON.stringify([
        { kind: "action", id: "missing", enabled: true },
        { kind: "action", id: "sleep", enabled: true },
        { kind: "control", id: "feed", label: "喂食", icon: "feed", enabled: true },
        { kind: "control", id: "chat", label: "聊天", icon: "chat", enabled: true },
      ]),
    });
    expect(ids(loadDock("girl", controls, actions, storage))).toEqual(["control:chat", "control:today", "control:notes", "control:focus"]);
  });

  it("keeps an empty label from being saved", () => {
    const storage = createMemoryStorage();
    const items = loadDock("girl", controls, actions, storage).map((item) => (item.kind === "control" ? { ...item, label: "  " } : item));
    saveDock("girl", items, storage);
    expect(loadDock("girl", controls, actions, storage)[0]).toMatchObject({ label: "聊聊天" });
  });

  it("moves the old focus settings and action shortcuts over", () => {
    const storage = createMemoryStorage({
      [characterKey("girl", CHARACTER_DATA.controlPreferences)]: JSON.stringify([{ id: "focus", label: "番茄", icon: "hourglass", enabled: false, order: 0 }]),
      [characterKey("girl", CHARACTER_DATA.actionShortcuts)]: JSON.stringify(["happy"]),
    });
    const items = loadDock("girl", controls, actions, storage);
    expect(ids(items)).toEqual(["control:chat", "control:today", "control:notes", "control:focus(off)", "action:happy"]);
    expect(items[3]).toMatchObject({ label: "番茄", icon: "hourglass" });
  });

  it("shows, hides and removes an action", () => {
    const base = loadDock("girl", controls, actions, createMemoryStorage());
    const added = setDockAction(base, "happy", true);
    expect(ids(added).slice(-1)[0]).toBe("action:happy");
    expect(ids(setDockAction(added, "happy", false)).slice(-1)[0]).toBe("action:happy(off)");
    expect(ids(setDockAction(setDockAction(added, "happy", false), "happy", true)).slice(-1)[0]).toBe("action:happy");
    expect(base).toHaveLength(4);
  });

  it("forgets every change on reset", () => {
    const storage = createMemoryStorage({ [characterKey("girl", CHARACTER_DATA.actionShortcuts)]: JSON.stringify(["happy"]) });
    saveDock("girl", [], storage);
    resetDock("girl", storage);
    expect(ids(loadDock("girl", controls, actions, storage))).toEqual(["control:chat", "control:today", "control:notes", "control:focus"]);
  });
});
