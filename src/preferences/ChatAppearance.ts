import { z } from "zod";
import type { PictureCrop } from "../appearance/pictureCrop";
import { PORTRAIT_ACTION } from "../assets/PackCatalog";
import { CHARACTER_DATA, characterKey } from "./CharacterPreferences";

/** Uploads are shrunk before saving (see `shrinkImage`), so this only guards against oversized data. */
export const MAX_DATA_URL_CHARS = 600_000;
/** Width over height of each frame: the round avatar and the box the peeking character sits in. */
export const FRAME_ASPECT = { avatar: 1, peek: 78 / 64 } as const;
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,/;

/** Where the picture sits in its frame; see `PictureCrop`. Without one, the old fixed framing is used. */
const cropSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), zoom: z.number().min(0.01).max(5), ratio: z.number().min(0.05).max(20) });
const pictureSchema = z.union([
  z.object({ action: z.string().min(1).max(100), crop: cropSchema.optional() }),
  z.object({ dataUrl: z.string().max(MAX_DATA_URL_CHARS).regex(DATA_URL), crop: cropSchema.optional() }),
]);
const schema = z.object({
  /** The round picture in the chat header and beside replies. */
  avatar: pictureSchema,
  /** The character peeking over the chat composer. */
  peek: z.union([pictureSchema, z.literal("hidden")]),
});

export type ChatPicture = z.infer<typeof pictureSchema>;
export type ChatAppearance = z.infer<typeof schema>;

export const DEFAULT_CHAT_APPEARANCE: ChatAppearance = { avatar: { action: PORTRAIT_ACTION }, peek: { action: PORTRAIT_ACTION } };
const key = (packId: string) => characterKey(packId, CHARACTER_DATA.chatAppearance);

export function loadChatAppearance(packId: string, storage: Storage = window.localStorage): ChatAppearance {
  try { const raw = storage.getItem(key(packId)); return raw ? schema.parse(JSON.parse(raw)) : DEFAULT_CHAT_APPEARANCE; }
  catch (error) { console.warn("Ignoring unreadable chat appearance", error); return DEFAULT_CHAT_APPEARANCE; }
}

export function saveChatAppearance(packId: string, value: ChatAppearance, storage: Storage = window.localStorage): void {
  storage.setItem(key(packId), JSON.stringify(schema.parse(value)));
}

export function resetChatAppearance(packId: string, storage: Storage = window.localStorage): void {
  storage.removeItem(key(packId));
}

export interface ShownPicture { src: string; fromAction: boolean; crop?: PictureCrop }

/**
 * The image to show and how to frame it. Without a saved crop, action images (full-body)
 * get the old head framing and uploads are shown whole. An action the character no longer has falls back to idle.
 */
export function pictureFor(picture: ChatPicture | "hidden", actionImages: Readonly<Record<string, string>>): ShownPicture | null {
  if (picture === "hidden") return null;
  const crop = picture.crop ? { crop: picture.crop } : {};
  if ("dataUrl" in picture) return { src: picture.dataUrl, fromAction: false, ...crop };
  const known = actionImages[picture.action];
  const src = known ?? actionImages[PORTRAIT_ACTION];
  // A crop made for a removed action does not fit the idle image it falls back to.
  return src ? { src, fromAction: true, ...(known ? crop : {}) } : null;
}
