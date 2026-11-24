import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";

const clonedVoiceSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  name: z.string(),
  format: z.enum(["wav", "mp3"]),
  seconds: z.number(),
  createdAt: z.number(),
  serviceVoiceId: z.string().optional(),
  serviceStatus: z.enum(["DEPLOYING", "OK", "UNDEPLOYED"]).optional(),
});

export type ClonedVoice = z.infer<typeof clonedVoiceSchema>;

function requireNative() {
  if (!isTauri()) throw new Error("CosyVoice 音色克隆需要在桌面应用中使用。");
}

export const cosyvoicePlatform = {
  async keyStatus(): Promise<boolean> {
    requireNative();
    return invoke("cosyvoice_key_status");
  },
  async saveKey(key: string): Promise<void> {
    requireNative();
    await invoke("cosyvoice_save_key", { key });
  },
  async clearKey(): Promise<void> {
    requireNative();
    await invoke("cosyvoice_clear_key");
  },
  async listVoices(): Promise<ClonedVoice[]> {
    requireNative();
    return z.array(clonedVoiceSchema).parse(await invoke("cloned_voice_list"));
  },
  async addVoice(name: string, base64: string, format: "wav" | "mp3", seconds: number): Promise<ClonedVoice> {
    requireNative();
    return clonedVoiceSchema.parse(await invoke("cloned_voice_add", { name, audioBase64: base64, format, seconds }));
  },
  async removeVoice(id: string): Promise<void> {
    requireNative();
    await invoke("cloned_voice_remove", { id });
  },
};
