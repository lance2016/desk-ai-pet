import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { DEFAULT_VOICE_PREFERENCES, forgetVoice, loadVoiceLanguage, loadVoicePreferences, saveVoiceLanguage, saveVoicePreferences } from "./VoicePreferences";

describe("voice language", () => {
  it("keeps one language for every character, starting from the old per-character choice", () => {
    const storage = createMemoryStorage({ "ai-pet:character:girl-default:voice-preferences:v1": JSON.stringify({ language: "en" }) });
    expect(loadVoiceLanguage("girl-default", storage)).toBe("en");
    expect(loadVoiceLanguage("other", storage)).toBe("auto");
    saveVoiceLanguage("zh", storage);
    expect(loadVoiceLanguage("girl-default", storage)).toBe("zh");
    expect(loadVoiceLanguage("other", storage)).toBe("zh");
  });
});

describe("cloned voices", () => {
  const clone = "clone:0123456789abcdef";
  const persona = { name: "小白", personality: "", voice: "白桦", voiceStyle: "低沉" } as const;

  it("keeps a cloned voice the user picked", () => {
    const storage = createMemoryStorage();
    saveVoicePreferences("girl-default", { ...DEFAULT_VOICE_PREFERENCES, voice: clone }, storage);
    expect(loadVoicePreferences("girl-default", persona, storage).voice).toBe(clone);
  });

  it("puts every character that used a deleted voice back on its own voice, and keeps its style", () => {
    const storage = createMemoryStorage();
    saveVoicePreferences("girl-default", { ...DEFAULT_VOICE_PREFERENCES, voice: clone, style: "轻快" }, storage);
    saveVoicePreferences("other", { ...DEFAULT_VOICE_PREFERENCES, voice: "苏打" }, storage);
    forgetVoice(clone, storage);
    expect(loadVoicePreferences("girl-default", persona, storage)).toMatchObject({ voice: "白桦", style: "轻快" });
    expect(loadVoicePreferences("other", persona, storage).voice).toBe("苏打");
  });

  it("refuses a voice that is neither MiMo's nor a clone", () => {
    expect(() => saveVoicePreferences("girl-default", { ...DEFAULT_VOICE_PREFERENCES, voice: "clone:../x" }, createMemoryStorage())).toThrow();
  });
});
