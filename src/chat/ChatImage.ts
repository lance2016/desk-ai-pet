import { z } from "zod";
import { shrinkImage } from "../components/settings/shrinkImage";

export const chatImageSchema = z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(128) });
export type ChatImage = z.infer<typeof chatImageSchema>;
export type AttachedChatImage = ChatImage & { dataUrl: string };

export const CHAT_IMAGE_TYPES = "image/png,image/jpeg,image/webp";
const MAX_IMAGE_SIDE = 1800;
/** Match the native data URL limit. The original stays on the user's machine. */
const MAX_DATA_URL_BYTES = 5 * 1024 * 1024;

export async function prepareChatImage(file: File, id: string): Promise<AttachedChatImage> {
  const { dataUrl } = await shrinkImage(file, MAX_IMAGE_SIDE);
  if (dataUrl.length > MAX_DATA_URL_BYTES) throw new Error("图片处理后仍然太大，请裁小一点再试。");
  return { id, name: file.name.slice(0, 128) || "截图", dataUrl };
}
