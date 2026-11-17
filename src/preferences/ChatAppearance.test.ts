import { describe, expect, it, vi } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { CHARACTER_DATA, characterKey } from "./CharacterPreferences";
import { chatPictureActions, DEFAULT_CHAT_APPEARANCE, loadChatAppearance, pictureFor, resetChatAppearance, saveChatAppearance } from "./ChatAppearance";

const IMAGES = { idle: "/pets/a/idle.png", happy: "/pets/a/happy.png" };
const UPLOAD = "data:image/png;base64,AAAA";

describe("chat appearance", () => {
  it("defaults to the idle image for both the avatar and the peeking character", () => {
    const storage = createMemoryStorage();
    expect(loadChatAppearance("cat", storage)).toEqual(DEFAULT_CHAT_APPEARANCE);
    expect(pictureFor(DEFAULT_CHAT_APPEARANCE.avatar, IMAGES)).toEqual({ src: IMAGES.idle, fromAction: true });
  });

  it("saves per character and can be reset", () => {
    const storage = createMemoryStorage();
    const value = { avatar: { dataUrl: UPLOAD }, peek: "hidden" as const };
    saveChatAppearance("cat", value, storage);
    expect(loadChatAppearance("cat", storage)).toEqual(value);
    expect(loadChatAppearance("dog", storage)).toEqual(DEFAULT_CHAT_APPEARANCE);
    resetChatAppearance("cat", storage);
    expect(loadChatAppearance("cat", storage)).toEqual(DEFAULT_CHAT_APPEARANCE);
  });

  it("resolves uploads, other actions, hidden and missing pictures", () => {
    expect(pictureFor({ dataUrl: UPLOAD }, IMAGES)).toEqual({ src: UPLOAD, fromAction: false });
    expect(pictureFor({ action: "happy" }, IMAGES)).toEqual({ src: IMAGES.happy, fromAction: true });
    expect(pictureFor("hidden", IMAGES)).toBeNull();
    // An action the character no longer has falls back to idle.
    expect(pictureFor({ action: "gone" }, IMAGES)).toEqual({ src: IMAGES.idle, fromAction: true });
    expect(pictureFor({ action: "gone" }, {})).toBeNull();
  });

  it("keeps a crop with the picture", () => {
    const storage = createMemoryStorage();
    const crop = { x: 0.4, y: 0.3, zoom: 0.6, ratio: 1.2 };
    saveChatAppearance("cat", { avatar: { action: "happy", crop }, peek: { dataUrl: UPLOAD, crop } }, storage);
    const loaded = loadChatAppearance("cat", storage);
    expect(pictureFor(loaded.avatar, IMAGES)).toEqual({ src: IMAGES.happy, fromAction: true, crop });
    expect(pictureFor(loaded.peek, IMAGES)).toEqual({ src: UPLOAD, fromAction: false, crop });
    expect(pictureFor({ action: "gone", crop }, IMAGES)).toEqual({ src: IMAGES.idle, fromAction: true });
  });

  it("rejects data that is not a small image and ignores unreadable data", () => {
    const storage = createMemoryStorage();
    expect(() => saveChatAppearance("cat", { avatar: { dataUrl: "javascript:alert(1)" }, peek: "hidden" }, storage)).toThrow();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    storage.setItem(characterKey("cat", CHARACTER_DATA.chatAppearance), "{");
    expect(loadChatAppearance("cat", storage)).toEqual(DEFAULT_CHAT_APPEARANCE);
    warn.mockRestore();
  });
});

describe("chatPictureActions", () => {
  it("lists the chosen actions once, after the portrait they fall back to", () => {
    expect(chatPictureActions(DEFAULT_CHAT_APPEARANCE)).toEqual(["idle"]);
    expect(chatPictureActions({ avatar: { action: "happy" }, peek: "hidden" })).toEqual(["idle", "happy"]);
    expect(chatPictureActions({ avatar: { dataUrl: UPLOAD }, peek: { action: "idle" } })).toEqual(["idle"]);
  });
});
