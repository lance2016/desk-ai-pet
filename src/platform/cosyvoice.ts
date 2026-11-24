import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";

/** Models a cloned voice can be bound to. Keep in sync with `MODELS` in `src-tauri/src/cosyvoice.rs`. */
export const CLONE_MODELS = ["cosyvoice-v3.5-flash", "cosyvoice-v3.5-plus"] as const;
export type CloneModel = (typeof CLONE_MODELS)[number];

const clonedVoiceSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{16}$/),
  name: z.string(),
  format: z.enum(["wav", "mp3"]),
  seconds: z.number(),
  createdAt: z.number(),
  model: z.enum(CLONE_MODELS),
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
  async addVoice(name: string, base64: string, format: "wav" | "mp3", seconds: number, model: CloneModel): Promise<ClonedVoice> {
    requireNative();
    return clonedVoiceSchema.parse(await invoke("cloned_voice_add", { name, audioBase64: base64, format, seconds, model }));
  },
  /** Clones the saved sample again for `model`; the voice keeps its ID, so characters using it keep it. */
  async switchModel(id: string, model: CloneModel): Promise<ClonedVoice> {
    requireNative();
    return clonedVoiceSchema.parse(await invoke("cloned_voice_switch_model", { id, model }));
  },
  async removeVoice(id: string): Promise<void> {
    requireNative();
    await invoke("cloned_voice_remove", { id });
  },
};
