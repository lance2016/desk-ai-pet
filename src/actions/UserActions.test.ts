import { describe, expect, it } from "vitest";
import { chatContext, NOTHING_SAVED } from "../agenda/chatTools";
import { createMemoryStorage, makeManifest } from "../testing/fixtures";
import { canShortcut } from "../preferences/ActionPreferences";
import { deleteUserAction, draftUserAction, loadUserActions, newUserActionId, saveUserAction, USER_ACTION_LIMITS, withUserActions } from "./UserActions";

const PACK = "test-pet";

describe("UserActions", () => {
  it("saves, renames and deletes an action", () => {
    const storage = createMemoryStorage();
    const id = newUserActionId();
    saveUserAction(PACK, { id, label: " 转圈 ", duration: 1500 }, storage, 10);
    saveUserAction(PACK, { id, label: "转两圈", duration: 3000 }, storage, 20);
    expect(loadUserActions(PACK, storage)).toEqual([{ id, label: "转两圈", duration: 3000, createdAt: 10 }]);
    deleteUserAction(PACK, id, storage);
    expect(loadUserActions(PACK, storage)).toEqual([]);
  });

  it("rejects blank names, bad lengths and foreign ids", () => {
    const storage = createMemoryStorage();
    expect(() => saveUserAction(PACK, { id: newUserActionId(), label: "  ", duration: 1500 }, storage)).toThrow();
    expect(() => saveUserAction(PACK, { id: newUserActionId(), label: "转圈", duration: USER_ACTION_LIMITS.maxDuration + 1 }, storage)).toThrow();
    expect(() => saveUserAction(PACK, { id: "happy", label: "转圈", duration: 1500 }, storage)).toThrow();
  });

  it("stops at the limit", () => {
    const storage = createMemoryStorage();
    for (let index = 0; index < USER_ACTION_LIMITS.count; index += 1) saveUserAction(PACK, { id: newUserActionId(), label: `动作${index}`, duration: 1500 }, storage);
    expect(() => saveUserAction(PACK, { id: newUserActionId(), label: "多一个", duration: 1500 }, storage)).toThrow();
  });

  it("keeps each character's actions apart and ignores broken data", () => {
    const storage = createMemoryStorage({ "ai-pet:character:other:user-actions:v1": "{" });
    saveUserAction(PACK, { id: newUserActionId(), label: "转圈", duration: 1500 }, storage);
    expect(loadUserActions("other", storage)).toEqual([]);
  });

  it("appends playable entries that wear the idle drawing and stay out of the AI's list", () => {
    const manifest = makeManifest();
    const id = newUserActionId();
    const merged = withUserActions(manifest, [{ id, label: "转圈", duration: 1500, createdAt: 0 }]);
    const entry = merged.animations.slice(-1)[0];
    expect(entry).toMatchObject({ id, label: "转圈", file: "a/idle.png", duration: 1500, loop: false });
    expect(canShortcut(entry)).toBe(true);
    expect(chatContext(0, merged.animations.map((action) => action.id), NOTHING_SAVED).actions).not.toContain(id);
    expect(withUserActions(manifest, [])).toBe(manifest);
  });

  it("starts a draft from the idle drawing", () => {
    expect(draftUserAction(makeManifest().animations)).toMatchObject({ id: "", file: "a/idle.png", category: "custom" });
  });
});
