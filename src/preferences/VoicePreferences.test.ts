import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../testing/fixtures";
import { loadVoiceLanguage, saveVoiceLanguage } from "./VoicePreferences";

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
