import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { z } from "zod";

const audioEventSchema = z.object({ id: z.string(), kind: z.enum(["chunk", "done", "error", "cancelled"]), data: z.string() });
export type MimoAudioEvent = z.infer<typeof audioEventSchema>;
function requireNative() { if (!isTauri()) throw new Error("MiMo 语音功能需要在桌面应用中使用。"); }
export const mimoPlatform = {
  async keyStatus(): Promise<boolean> { requireNative(); return invoke("mimo_key_status"); },
  async saveKey(key: string): Promise<void> { requireNative(); await invoke("mimo_save_key", { key }); },
  async clearKey(): Promise<void> { requireNative(); await invoke("mimo_clear_key"); },
  async transcribe(base64: string, language: "auto" | "zh" | "en"): Promise<string> {
    requireNative(); return invoke("mimo_transcribe", { audioBase64: base64, format: "wav", language });
  },
  /** Stops a running transcription; `transcribe` then rejects with "cancelled". */
  async cancelTranscription(): Promise<void> { requireNative(); await invoke("mimo_transcribe_cancel"); },
  async startSynthesis(requestId: string, text: string, voice: string, style: string): Promise<void> {
    requireNative(); await invoke("mimo_synthesize", { requestId, text, voice, style });
  },
  async cancelSpeech(requestId: string): Promise<void> { requireNative(); await invoke("mimo_speech_cancel", { requestId }); },
  async subscribeAudio(handler: (event: MimoAudioEvent) => void): Promise<() => void> {
    requireNative();
    return listen("pet://mimo-audio", (event) => { const parsed = audioEventSchema.safeParse(event.payload); if (parsed.success) handler(parsed.data); });
  },
};
